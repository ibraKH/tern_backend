import pool from '../../../src/config/database';
import { getPendingMentions, markMentionsNotified } from '../../../src/services/collab/mentions.service';

jest.mock('../../../src/config/database', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

const mockQuery = pool.query as jest.Mock;

describe('mentions.service', () => {
  afterEach(() => jest.clearAllMocks());

  describe('getPendingMentions', () => {
    it('returns mapped notifications for the user', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            comment_id: 10,
            model_name: 'MySTM',
            comment_text: 'hello @user@test.com',
            author_email: 'author@test.com',
            created_at: '2026-04-01T00:00:00Z',
          },
        ],
      });

      const result = await getPendingMentions(42);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 1,
        commentId: 10,
        modelName: 'MySTM',
        commentText: 'hello @user@test.com',
        authorEmail: 'author@test.com',
        createdAt: '2026-04-01T00:00:00Z',
      });
      // Query must filter by userId and notified_at IS NULL
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('mentioned_user_id = $1'),
        [42]
      );
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('notified_at IS NULL'),
        [42]
      );
    });

    it('returns an empty array when no pending mentions exist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const result = await getPendingMentions(1);
      expect(result).toEqual([]);
    });
  });

  describe('markMentionsNotified', () => {
    it('executes UPDATE with the given ids and userId', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 2 });

      await markMentionsNotified([1, 2], 42);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('notified_at = NOW()'),
        [[1, 2], 42]
      );
      // Security: query must also scope to the owning user
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('mentioned_user_id = $2'),
        [[1, 2], 42]
      );
    });

    it('skips the query when given an empty ids array', async () => {
      await markMentionsNotified([], 42);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });
});
