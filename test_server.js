const http = require('http');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Import server app
const app = require('./server');

const TEST_PORT = 3456;
let server;

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const reqHeaders = { ...headers };
    let bodyData = null;

    if (body) {
      if (Buffer.isBuffer(body)) {
        bodyData = body;
        if (!reqHeaders['Content-Type']) reqHeaders['Content-Type'] = 'application/octet-stream';
        reqHeaders['Content-Length'] = body.length;
      } else if (typeof body === 'object') {
        bodyData = JSON.stringify(body);
        reqHeaders['Content-Type'] = 'application/json';
        reqHeaders['Content-Length'] = Buffer.byteLength(bodyData);
      }
    }

    const req = http.request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path,
      method,
      headers: reqHeaders
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        let json = null;
        try {
          json = JSON.parse(raw.toString('utf-8'));
        } catch {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: json,
          raw
        });
      });
    });

    req.on('error', reject);
    if (bodyData) req.write(bodyData);
    req.end();
  });
}

async function runTests() {
  console.log('--- Starting Cloud Clipboard Platform Test Suite ---');

  // Reset rate limits for test IP (127.0.0.1)
  const db = require('./db/database');
  db.prepare("DELETE FROM rate_limits").run();

  server = app.listen(TEST_PORT, async () => {
    try {
      // 1. Health check & secret generator
      console.log('1. Testing /api/shares/meta/generate-secrets...');
      const secretsRes = await request('GET', '/api/shares/meta/generate-secrets');
      assert.strictEqual(secretsRes.statusCode, 200);
      assert.ok(secretsRes.body.suggestedPin);
      assert.ok(secretsRes.body.suggestedPasscode);
      console.log('   ✓ Suggested secrets endpoint works.');

      // 2. Create a share with text snippet, PIN, Passcode, and 2 max downloads
      console.log('2. Testing Share Creation with PIN & Passcode...');
      const createRes = await request('POST', '/api/shares', {
        title: 'Confidential Notes',
        contentText: 'Secret clipboard string 123456789!',
        pin: '123456',
        passcode: 'tiger-river-42',
        maxDownloads: 2,
        expiryMinutes: 60
      });

      assert.strictEqual(createRes.statusCode, 201);
      const share = createRes.body.share;
      assert.ok(share.id);
      assert.ok(share.token);
      assert.strictEqual(share.pin, '123456');
      assert.strictEqual(share.passcode, 'tiger-river-42');
      console.log(`   ✓ Share created. Token: ${share.token}`);

      // 3. Retrieve via Direct URL token
      console.log('3. Testing Retrieval via URL Token...');
      const tokenRes = await request('GET', `/api/shares/${share.token}`);
      assert.strictEqual(tokenRes.statusCode, 200);
      assert.strictEqual(tokenRes.body.share.title, 'Confidential Notes');
      // Passcode is required, so contentText should be hidden
      assert.strictEqual(tokenRes.body.share.isLocked, true);
      assert.strictEqual(tokenRes.body.share.contentText, null);
      console.log('   ✓ Direct token retrieved (correctly masked as locked).');

      // 4. Unlock with Passcode
      console.log('4. Testing Share Unlock with Passcode...');
      const unlockRes = await request('POST', `/api/shares/${share.token}/unlock`, {
        passcode: 'tiger-river-42'
      });
      assert.strictEqual(unlockRes.statusCode, 200);
      assert.strictEqual(unlockRes.body.share.isLocked, false);
      assert.strictEqual(unlockRes.body.share.contentText, 'Secret clipboard string 123456789!');
      console.log('   ✓ Unlocked with passcode successfully.');

      // 5. Retrieve via 6-digit numeric PIN
      console.log('5. Testing Retrieval via PIN...');
      const pinRes = await request('POST', '/api/access/pin', { pin: '123456' });
      assert.strictEqual(pinRes.statusCode, 200);
      assert.strictEqual(pinRes.body.share.contentText, 'Secret clipboard string 123456789!');
      console.log('   ✓ Retrieved via PIN successfully.');

      // 6. Test PIN Rate Limiter
      console.log('6. Testing PIN Brute-Force Rate Limiting...');
      let rateLimited = false;
      for (let i = 0; i < 6; i++) {
        const failRes = await request('POST', '/api/access/pin', { pin: '999999' });
        if (failRes.statusCode === 429) {
          rateLimited = true;
          assert.ok(failRes.body.retryAfter > 0);
          console.log(`   ✓ Rate limiter successfully triggered HTTP 429 on attempt ${i + 1}`);
          break;
        }
      }
      assert.ok(rateLimited, 'Rate limiter did not trigger 429 after 5 failed attempts');

      // 7. Test Chunked Upload
      console.log('7. Testing Chunked File Upload (Resumable)...');
      // Create a test file of 12 MB (split into 3 chunks: 5MB + 5MB + 2MB)
      const chunk1 = crypto.randomBytes(5 * 1024 * 1024);
      const chunk2 = crypto.randomBytes(5 * 1024 * 1024);
      const chunk3 = crypto.randomBytes(2 * 1024 * 1024);
      const fullBuffer = Buffer.concat([chunk1, chunk2, chunk3]);
      const expectedSha256 = crypto.createHash('sha256').update(fullBuffer).digest('hex');

      // 7a. Init upload
      const initRes = await request('POST', '/api/upload/init', {
        shareId: share.id,
        fileName: 'dataset_archive.bin',
        fileSize: fullBuffer.length,
        mimeType: 'application/octet-stream',
        totalChunks: 3
      });
      assert.strictEqual(initRes.statusCode, 200);
      const uploadId = initRes.body.session.uploadId;
      console.log(`   ✓ Upload initialized. UploadId: ${uploadId}`);

      // 7b. Upload Chunk 0
      const c0Res = await request('POST', '/api/upload/chunk', chunk1, {
        'x-upload-id': uploadId,
        'x-chunk-index': '0',
        'x-total-chunks': '3'
      });
      assert.strictEqual(c0Res.statusCode, 200);

      // 7c. Check Status (resumability)
      const statusRes = await request('GET', `/api/upload/status/${uploadId}`);
      assert.strictEqual(statusRes.statusCode, 200);
      assert.deepStrictEqual(statusRes.body.status.uploadedChunks, [0]);
      console.log('   ✓ Resumability status verified: server reported chunk 0 received.');

      // 7d. Upload Chunks 1 and 2
      await request('POST', '/api/upload/chunk', chunk2, {
        'x-upload-id': uploadId,
        'x-chunk-index': '1',
        'x-total-chunks': '3'
      });
      await request('POST', '/api/upload/chunk', chunk3, {
        'x-upload-id': uploadId,
        'x-chunk-index': '2',
        'x-total-chunks': '3'
      });

      // 7e. Complete upload
      const completeRes = await request('POST', '/api/upload/complete', { uploadId });
      assert.strictEqual(completeRes.statusCode, 200);
      const fileRecord = completeRes.body.file;
      assert.strictEqual(fileRecord.file_size, fullBuffer.length);
      assert.strictEqual(fileRecord.checksum_sha256, expectedSha256);
      console.log(`   ✓ File merged & verified. Checksum SHA-256 matches: ${expectedSha256.slice(0, 16)}...`);

      // 8. Test 500 MB Size Limit Guard (Server-Side)
      console.log('8. Testing 500 MB Size Limit Guard...');
      const oversizedRes = await request('POST', '/api/upload/init', {
        shareId: share.id,
        fileName: 'huge_file.iso',
        fileSize: 501 * 1024 * 1024, // 501 MB
        mimeType: 'application/octet-stream',
        totalChunks: 101
      });
      assert.strictEqual(oversizedRes.statusCode, 400);
      console.log('   ✓ Server correctly rejected > 500 MB file.');

      // 9. Test Streaming Resumable Download with HTTP Range Header
      console.log('9. Testing Resumable Streaming Download (HTTP 206 Range)...');
      const rangeRes = await request('GET', `/api/shares/${share.token}/files/${fileRecord.id}/download?passcode=tiger-river-42`, null, {
        Range: 'bytes=0-1023' // First 1 KB
      });
      assert.strictEqual(rangeRes.statusCode, 206);
      assert.strictEqual(rangeRes.headers['content-range'], `bytes 0-1023/${fullBuffer.length}`);
      assert.strictEqual(rangeRes.raw.length, 1024);
      assert.deepStrictEqual(rangeRes.raw, fullBuffer.subarray(0, 1024));
      console.log('   ✓ HTTP 206 Partial Content streamed matching slice bytes.');

      // 10. Test QR Code Generation Endpoint
      console.log('10. Testing QR Code Generation...');
      const qrRes = await request('GET', `/api/access/qr?text=http://localhost:3000/s/${share.token}`);
      assert.strictEqual(qrRes.statusCode, 200);
      assert.ok(qrRes.body.dataUrl.startsWith('data:image/png;base64,'));
      console.log('   ✓ QR Code data URL generated successfully.');

      // 11. Test Download Limit Expiration (maxDownloads = 2)
      // Note: Test 9 performed initial download #1.
      console.log('11. Testing Download Limit Enforcement (Auto-expiry after 2 downloads)...');
      // Download 2 (hits max_downloads = 2)
      const dl2 = await request('GET', `/api/shares/${share.token}/files/${fileRecord.id}/download?passcode=tiger-river-42`);
      assert.strictEqual(dl2.statusCode, 200);
      // Download 3 (should return HTTP 410 Gone / Expired)
      const dl3 = await request('GET', `/api/shares/${share.token}/files/${fileRecord.id}/download?passcode=tiger-river-42`);
      assert.strictEqual(dl3.statusCode, 410);
      console.log('   ✓ Expiry/download limit enforced: third download correctly returned HTTP 410.');

      console.log('\n======================================================');
      console.log('   ALL 11 TESTS PASSED SUCCESSFULLY! 🚀');
      console.log('======================================================\n');
      process.exit(0);

    } catch (err) {
      console.error('\n❌ Test failure:', err);
      process.exit(1);
    }
  });
}

runTests();
