import request from 'supertest';
import app from '../../src/app';
import pool from '../../src/config/database';
import { verifyToken } from '../../src/utils/jwt';

const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};


jest.mock('../../src/config/database', () => {
  return {
    __esModule: true,
    default: {
      connect: jest.fn().mockImplementation(() => Promise.resolve(mockClient)),
      query: jest.fn(),
    },
    pool: {
      connect: jest.fn().mockImplementation(() => Promise.resolve(mockClient)),
      query: jest.fn(),
    }
  };
});

jest.mock('../../src/utils/jwt', () => ({
  __esModule: true,
  verifyToken: jest.fn(),
}));

describe('Admin Upload Routes', () => {
  const adminToken = 'mock-admin-token';

  beforeEach(() => {
    jest.clearAllMocks();

    (verifyToken as jest.Mock).mockReturnValue({ uid: 1 });

    (pool.query as jest.Mock).mockResolvedValue({
      rows: [
        { id: 1, email: 'admin@test.com', role: 'Admin', contributor_id: null },
      ],
    });
    mockClient.query.mockResolvedValue({ 
      rows: [{ id: 100 }], 
      rowCount: 1 
    });
  });

  describe('Drivers Upload (CSV/JSON)', () => {
    it('should upload drivers via CSV successfully', async () => {
      const csvContent = 'name,description,category\nDriver1,Desc1,Cat1';
      
      const response = await request(app)
        .post('/admin/drivers/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', Buffer.from(csvContent), 'drivers.csv');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Drivers uploaded successfully');
    });

    it('should return 400 for malformed CSV (missing required columns)', async () => {
      const badCsv = 'name,description\nDriver1,Desc1'; // 缺少 category
      
      const response = await request(app)
        .post('/admin/drivers/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', Buffer.from(badCsv), 'drivers.csv');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Template Upload (JSON)', () => {
    it('should upload template via JSON successfully', async () => {
      const validJson = { 
        stm_name: 'New Model',
        version: '1.0.0'
      };

      const response = await request(app)
        .post('/admin/templates/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', Buffer.from(JSON.stringify(validJson)), 'template.json');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Template uploaded successfully');
    });

    it('should return 400 for invalid JSON (Zod schema validation failed)', async () => {
      const invalidJson = { 
        name: 'Missing stm_name field' 
      };

      const response = await request(app)
        .post('/admin/templates/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', Buffer.from(JSON.stringify(invalidJson)), 'template.json');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Security & File Constraints', () => {
    it('should return 403 for non-admin users', async () => {

      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ id: 2, email: 'user@test.com', role: 'Viewer', contributor_id: null }],
      });

      const response = await request(app)
        .post('/admin/drivers/upload')
        .set('Authorization', 'Bearer mock-token')
        .attach('file', Buffer.from('name,description,category\nD,D,C'), 'drivers.csv');

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('should return 413 for file exceeding size limit', async () => {
      const largeFile = Buffer.alloc(6 * 1024 * 1024); // 6MB

      const response = await request(app)
        .post('/admin/drivers/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', largeFile, 'too_large.csv');

      expect(response.status).toBe(413);
    });

    it('should return 400 when no file is uploaded', async () => {
      const response = await request(app)
        .post('/admin/drivers/upload')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});