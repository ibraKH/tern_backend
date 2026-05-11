import pool from '../../../src/config/database';
import { createComment, getComments, resolveComment, deleteComment } from '../../../src/services/collab/comments.service';

jest.mock('../../../src/config/database', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

const mockQuery = pool.query as jest.Mock;

describe('comments.service', () => {
  afterEach(() => jest.clearAllMocks());

  describe('createComment', () => {
    it('creates a comment and returns it with author email', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 10 }] })  // model lookup
        .mockResolvedValueOnce({                          // insert
          rows: [{
            id: 1, entity_type: 'node', entity_id: 5, parent_id: null,
            body: 'test comment', resolved: false,
            created_at: '2026-01-01', updated_at: '2026-01-01',
          }],
        })
        .mockResolvedValueOnce({ rows: [{ email: 'author@test.com' }] }); // author lookup

      const result = await createComment({
        modelName: 'M1', entityType: 'node', entityId: 5, authorId: 1, body: 'test comment',
      });

      expect(result).toMatchObject({
        id: 1, body: 'test comment',
        author: { id: 1, email: 'author@test.com' },
      });
    });

    it('resolves @mentions in body', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 10 }] })
        .mockResolvedValueOnce({
          rows: [{
            id: 2, entity_type: null, entity_id: null, parent_id: null,
            body: 'cc @user@test.com please', resolved: false,
            created_at: '2026-01-01', updated_at: '2026-01-01',
          }],
        })
        .mockResolvedValueOnce({ rows: [{ email: 'me@test.com' }] })   // author lookup
        .mockResolvedValueOnce({ rows: [{ id: 99 }] })                  // mention user lookup
        .mockResolvedValueOnce({ rowCount: 1 });                         // insert mention

      const result = await createComment({
        modelName: 'M1', authorId: 1, body: 'cc @user@test.com please',
      });

      expect(result.mentions).toContain('user@test.com');
    });

    it('throws 404 when model not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await expect(
        createComment({ modelName: 'NoModel', authorId: 1, body: 'hi' })
      ).rejects.toThrow('Model not found');
    });
  });

  describe('getComments', () => {
    it('returns paginated comments for a model', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 10 }] })              // model lookup
        .mockResolvedValueOnce({ rows: [{ count: '1' }] })           // COUNT query
        .mockResolvedValueOnce({
          rows: [{
            id: 1, entity_type: 'node', entity_id: 5, parent_id: null,
            body: 'hello', resolved: false, created_at: '2026-01-01',
            updated_at: '2026-01-01', user_id: 1, email: 'a@b.com',
          }],
        });

      const result = await getComments('M1');
      expect(result.comments).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.comments[0]).toMatchObject({ body: 'hello', author: { email: 'a@b.com' } });
    });

    it('returns empty paginated result when model not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const result = await getComments('X');
      expect(result.comments).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('resolveComment', () => {
    it('resolves when called by author', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ user_id: 1, resolved: false }] })
        .mockResolvedValueOnce({ rowCount: 1 });

      await expect(resolveComment(1, 1, 'Editor')).resolves.toBeUndefined();
    });

    it('resolves when called by Admin', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ user_id: 2, resolved: false }] })
        .mockResolvedValueOnce({ rowCount: 1 });

      await expect(resolveComment(1, 1, 'Admin')).resolves.toBeUndefined();
    });

    it('throws 403 when called by non-author Editor', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 2, resolved: false }] });

      await expect(resolveComment(1, 1, 'Editor')).rejects.toThrow('Forbidden');
    });

    it('throws 409 when already resolved', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 1, resolved: true }] });

      await expect(resolveComment(1, 1, 'Editor')).rejects.toThrow('Already resolved');
    });

    it('throws 404 when comment not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await expect(resolveComment(999, 1, 'Admin')).rejects.toThrow('Comment not found');
    });
  });

  describe('deleteComment', () => {
    it('deletes when called by author', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ user_id: 1, body: 'hi' }] })
        .mockResolvedValueOnce({ rowCount: 1 });

      await expect(deleteComment(1, 1, 'Editor')).resolves.toBeUndefined();
    });

    it('throws 403 when called by non-author non-Admin', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 2, body: 'hi' }] });

      await expect(deleteComment(1, 1, 'Editor')).rejects.toThrow('Forbidden');
    });
  });
});
