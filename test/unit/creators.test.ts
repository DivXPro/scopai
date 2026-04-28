import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCreator,
  getCreatorById,
  getCreatorByPlatformAuthorId,
  listCreators,
  countCreators,
  updateCreator,
  updateCreatorStatus,
  updateCreatorLastSynced,
  deleteCreator,
  createPlatform,
  getDbPath,
  close,
  exec,
} from '../../packages/core/src/index.ts';
import type { Creator } from '../../packages/core/src/shared/types.ts';

describe('creators CRUD', () => {
  before(async () => {
    // Ensure a clean test database
    const dbPath = getDbPath();
    try {
      await close();
      const fs = await import('fs');
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }
    } catch {
      // ignore
    }
    // Re-run schema
    const { migrate } = await import('../../packages/core/src/index.ts');
    await migrate();
    // Seed a platform
    await createPlatform({ id: 'test-platform', name: 'Test Platform', description: null });
  });

  const baseCreator: Omit<Creator, 'id' | 'created_at' | 'updated_at' | 'last_synced_at'> = {
    platform_id: 'test-platform',
    platform_author_id: 'author-123',
    author_name: 'Test Author',
    display_name: 'Test Display Name',
    bio: 'A test bio',
    avatar_url: 'https://example.com/avatar.jpg',
    homepage_url: 'https://example.com',
    follower_count: 100,
    following_count: 50,
    post_count: 25,
    status: 'active',
    metadata: { extra: 'data' },
  };

  it('should create a creator', async () => {
    const creator = await createCreator(baseCreator);
    assert.ok(creator.id, 'creator should have an id');
    assert.ok(creator.created_at, 'creator should have created_at');
    assert.ok(creator.updated_at, 'creator should have updated_at');
    assert.strictEqual(creator.last_synced_at, null, 'last_synced_at should be null');
    assert.strictEqual(creator.author_name, 'Test Author');
    assert.strictEqual(creator.status, 'active');
  });

  it('should get a creator by id', async () => {
    const created = await createCreator({ ...baseCreator, platform_author_id: 'author-456' });
    const fetched = await getCreatorById(created.id);
    assert.ok(fetched, 'should find creator by id');
    assert.strictEqual(fetched!.id, created.id);
    assert.strictEqual(fetched!.platform_author_id, 'author-456');
  });

  it('should return null for non-existent id', async () => {
    const fetched = await getCreatorById('non-existent-id');
    assert.strictEqual(fetched, null);
  });

  it('should get a creator by platform author id', async () => {
    const created = await createCreator({ ...baseCreator, platform_author_id: 'author-789' });
    const fetched = await getCreatorByPlatformAuthorId('test-platform', 'author-789');
    assert.ok(fetched, 'should find creator by platform + author id');
    assert.strictEqual(fetched!.id, created.id);
  });

  it('should list creators with filtering', async () => {
    // Create creators with different statuses
    await createCreator({ ...baseCreator, platform_author_id: 'list-1', status: 'active' });
    await createCreator({ ...baseCreator, platform_author_id: 'list-2', status: 'paused' });

    const active = await listCreators('test-platform', 'active');
    assert.ok(active.length >= 1, 'should have at least 1 active creator');
    assert.ok(active.every(c => c.status === 'active'), 'all returned should be active');

    const paused = await listCreators('test-platform', 'paused');
    assert.ok(paused.length >= 1, 'should have at least 1 paused creator');
    assert.ok(paused.every(c => c.status === 'paused'), 'all returned should be paused');
  });

  it('should count creators', async () => {
    const beforeCount = await countCreators('test-platform', 'active');
    assert.ok(typeof beforeCount === 'number', 'count should be a number');
    assert.ok(beforeCount >= 0, 'count should be >= 0');

    await createCreator({ ...baseCreator, platform_author_id: 'count-test', status: 'active' });
    const afterCount = await countCreators('test-platform', 'active');
    assert.strictEqual(afterCount, beforeCount + 1, 'count should increase by 1');
  });

  it('should update a creator', async () => {
    const created = await createCreator({ ...baseCreator, platform_author_id: 'update-test' });
    await updateCreator(created.id, { display_name: 'Updated Name', follower_count: 999 });
    const updated = await getCreatorById(created.id);
    assert.ok(updated, 'should still exist');
    assert.strictEqual(updated!.display_name, 'Updated Name');
    assert.strictEqual(updated!.follower_count, 999);
    // Fields not updated should remain
    assert.strictEqual(updated!.author_name, baseCreator.author_name);
  });

  it('should update creator status', async () => {
    const created = await createCreator({ ...baseCreator, platform_author_id: 'status-test' });
    await updateCreatorStatus(created.id, 'paused');
    const updated = await getCreatorById(created.id);
    assert.strictEqual(updated!.status, 'paused');

    await updateCreatorStatus(created.id, 'unsubscribed');
    const updated2 = await getCreatorById(created.id);
    assert.strictEqual(updated2!.status, 'unsubscribed');
  });

  it('should update last_synced_at', async () => {
    const created = await createCreator({ ...baseCreator, platform_author_id: 'sync-test' });
    assert.strictEqual(created.last_synced_at, null);

    const syncTime = new Date('2024-01-15T10:30:00Z');
    await updateCreatorLastSynced(created.id, syncTime);
    const updated = await getCreatorById(created.id);
    assert.ok(updated!.last_synced_at, 'last_synced_at should be set');
  });

  it('should delete a creator', async () => {
    const created = await createCreator({ ...baseCreator, platform_author_id: 'delete-test' });
    await deleteCreator(created.id);
    const fetched = await getCreatorById(created.id);
    assert.strictEqual(fetched, null, 'deleted creator should not exist');
  });

  it('should handle empty update gracefully', async () => {
    const created = await createCreator({ ...baseCreator, platform_author_id: 'empty-update-test' });
    // Should not throw
    await updateCreator(created.id, {});
    const fetched = await getCreatorById(created.id);
    assert.ok(fetched, 'creator should still exist');
  });
});
