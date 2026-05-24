var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var { execFileSync } = require('node:child_process');
var path = require('node:path');
var fs = require('node:fs');

var harnessPath = path.resolve(__dirname, 'harness', 'pr-harness.js');

describe('pr-harness output validation', function () {
  it('harness file exists', function () {
    assert.ok(fs.existsSync(harnessPath), 'pr-harness.js must exist at tests/harness/pr-harness.js');
  });

  it('harness exits with code 0', function () {
    // execFileSync throws on non-zero exit
    var output = execFileSync('node', [harnessPath], { encoding: 'utf8', timeout: 10000 });
    assert.ok(output.length > 0, 'harness should produce output');
  });

  it('output contains Precision/Recall Report header', function () {
    var output = execFileSync('node', [harnessPath], { encoding: 'utf8', timeout: 10000 });
    assert.ok(output.includes('Precision/Recall Report'), 'output must contain "Precision/Recall Report"');
  });

  it('output includes threshold rows from 0.10 to 0.90', function () {
    var output = execFileSync('node', [harnessPath], { encoding: 'utf8', timeout: 10000 });
    assert.ok(output.includes('T=0.10'), 'output must include T=0.10');
    assert.ok(output.includes('T=0.50'), 'output must include T=0.50');
    assert.ok(output.includes('T=0.90'), 'output must include T=0.90');
  });

  it('each threshold row contains P, R, F1, F0.5, TP, FP, FN, TN', function () {
    var output = execFileSync('node', [harnessPath], { encoding: 'utf8', timeout: 10000 });
    var lines = output.split('\n').filter(function (l) { return l.indexOf('T=') === 0; });
    assert.ok(lines.length >= 17, 'should have at least 17 threshold rows (got ' + lines.length + ')');
    lines.forEach(function (line) {
      assert.ok(line.includes('P='), 'line missing P=: ' + line);
      assert.ok(line.includes('R='), 'line missing R=: ' + line);
      assert.ok(line.includes('F1='), 'line missing F1=: ' + line);
      assert.ok(line.includes('F0.5='), 'line missing F0.5=: ' + line);
      assert.ok(line.includes('TP='), 'line missing TP=: ' + line);
      assert.ok(line.includes('FP='), 'line missing FP=: ' + line);
      assert.ok(line.includes('FN='), 'line missing FN=: ' + line);
      assert.ok(line.includes('TN='), 'line missing TN=: ' + line);
    });
  });

  it('F0.5 at CONFIDENCE_THRESHOLD meets or exceeds Phase 30 baseline (0.926)', function () {
    var output = execFileSync('node', [harnessPath], { encoding: 'utf8', timeout: 10000 });
    var { SCORING_CONFIG } = require('../src/shared/scoring-config.js');
    var targetT = SCORING_CONFIG.MATCHING.CONFIDENCE_THRESHOLD.toFixed(2);
    var line = output.split('\n').find(function (l) { return l.indexOf('T=' + targetT) === 0; });
    assert.ok(line, 'harness output must contain row for T=' + targetT);
    var f05Match = line.match(/F0\.5=([0-9.]+)/);
    assert.ok(f05Match, 'threshold row must contain F0.5 value');
    var f05 = parseFloat(f05Match[1]);
    assert.ok(f05 >= 0.926, 'F0.5 at T=' + targetT + ' must be >= 0.926 (Phase 30 baseline), got ' + f05);
  });

  it('harness imports nameMatchConfidence from scoring.js (not re-implemented)', function () {
    var source = fs.readFileSync(harnessPath, 'utf8');
    assert.ok(/require.*scoring/.test(source), 'harness must require scoring.js');
    assert.ok(source.includes('nameMatchConfidence'), 'harness must use nameMatchConfidence');
  });
});
