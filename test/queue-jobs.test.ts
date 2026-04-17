import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../dist/db/client.js';
const { query, run, close: closeDb } = db;
import * as migrate from '../dist/db/migrate.js';
const { runMigrations } = migrate;
import * as seed from '../dist/db/seed.js';
const { seedAll } = seed;
import * as queueJobs from '../dist/db/queue-jobs.js';
const { enqueueJob, getNextJob, getNextJobs, requeueJob, recoverStalledJobs, listJobsByTask } = queueJobs;
import * as utils from '../dist/shared/utils.js';
const { generateId, now } = utils;
import * as tasks from '../dist/db/tasks.js';
const { createTask } = tasks;

const RUN_ID = `qj_${Date.now()}`;
const TEST_TASK_ID = `${RUN_ID}_task`;

describe('queue-jobs — recovery and retry logic', { timeout: 15000 }, () => {
  before(async () => {
    closeDb();
    await runMigrations();
    await seedAll();

    await createTask({
      id: TEST_TASK_ID,
      name: 'Queue Jobs Test Task',
      description: null,
      template_id: null,
      status: 'pending',
      stats: { total: 0, done: 0, failed: 0 },
      created_at: now(),
      updated_at: now(),
      completed_at: null,
    });
  });

  beforeEach(async () => {
    await run("DELETE FROM queue_jobs");
  });

  it('getNextJob increments attempts when claiming a pending job', async () => {
    const jobId = generateId();
    await enqueueJob({
      id: jobId,
      task_id: TEST_TASK_ID,
      strategy_id: null,
      target_type: 'post',
      target_id: 'post_1',
      status: 'pending',
      priority: 0,
      attempts: 0,
      max_attempts: 3,
      error: null,
      created_at: now(),
      processed_at: null,
    });

    const job = await getNextJob();
    assert.ok(job);
    assert.equal(job.id, jobId);
    assert.equal(job.status, 'processing');
    assert.equal(job.attempts, 1);
  });

  it('getNextJobs increments attempts for each claimed job', async () => {
    const jobs: any[] = [];
    for (let i = 0; i < 3; i++) {
      const jobId = generateId();
      jobs.push({
        id: jobId,
        task_id: TEST_TASK_ID,
        strategy_id: null,
        target_type: 'post',
        target_id: `post_batch_${i}`,
        status: 'pending',
        priority: 0,
        attempts: 0,
        max_attempts: 3,
        error: null,
        created_at: now(),
        processed_at: null,
      });
    }
    for (const j of jobs) await enqueueJob(j);

    const claimed = await getNextJobs(3);
    assert.equal(claimed.length, 3);
    for (const c of claimed) {
      assert.equal(c.status, 'processing');
      assert.equal(c.attempts, 1);
    }
  });

  it('requeueJob keeps attempts unchanged so next claim increments again', async () => {
    const jobId = generateId();
    await enqueueJob({
      id: jobId,
      task_id: TEST_TASK_ID,
      strategy_id: null,
      target_type: 'post',
      target_id: 'post_requeue',
      status: 'pending',
      priority: 0,
      attempts: 0,
      max_attempts: 3,
      error: null,
      created_at: now(),
      processed_at: null,
    });

    let job = await getNextJob();
    assert.ok(job);
    assert.equal(job.attempts, 1);

    await requeueJob(jobId, 'rate limit');

    job = await getNextJob();
    assert.ok(job);
    assert.equal(job.id, jobId);
    assert.equal(job.attempts, 2);
  });

  it('recoverStalledJobs resets processing jobs under max_attempts back to pending', async () => {
    const jobId = generateId();
    await enqueueJob({
      id: jobId,
      task_id: TEST_TASK_ID,
      strategy_id: null,
      target_type: 'post',
      target_id: 'post_recover_ok',
      status: 'pending',
      priority: 0,
      attempts: 0,
      max_attempts: 3,
      error: null,
      created_at: now(),
      processed_at: null,
    });

    // Simulate crash: claim job then leave it in processing
    const claimed = await getNextJob();
    assert.ok(claimed);
    assert.equal(claimed.status, 'processing');
    assert.equal(claimed.attempts, 1);

    const result = await recoverStalledJobs();
    assert.equal(result.recovered, 1);
    assert.equal(result.failed, 0);

    const job = await getNextJob();
    assert.ok(job);
    assert.equal(job.id, jobId);
    // attempts should have been incremented again on re-claim
    assert.equal(job.attempts, 2);
  });

  it('recoverStalledJobs marks processing jobs as failed when attempts >= max_attempts', async () => {
    const jobId = generateId();
    await enqueueJob({
      id: jobId,
      task_id: TEST_TASK_ID,
      strategy_id: null,
      target_type: 'post',
      target_id: 'post_recover_fail',
      status: 'pending',
      priority: 0,
      attempts: 0,
      max_attempts: 2,
      error: null,
      created_at: now(),
      processed_at: null,
    });

    // First claim
    let job = await getNextJob();
    assert.ok(job);
    assert.equal(job.attempts, 1);

    // Requeue and claim again to reach attempts = 2
    await requeueJob(jobId, 'timeout');
    job = await getNextJob();
    assert.ok(job);
    assert.equal(job.attempts, 2);

    // Simulate crash while processing (attempts == max_attempts)
    const result = await recoverStalledJobs();
    assert.equal(result.recovered, 0);
    assert.equal(result.failed, 1);

    const list = await listJobsByTask(TEST_TASK_ID);
    const recoveredJob = list.find(j => j.id === jobId);
    assert.ok(recoveredJob);
    assert.equal(recoveredJob.status, 'failed');
  });
});
