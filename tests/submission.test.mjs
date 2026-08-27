import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("해커톤 게임 소개는 200자 이하다", () => {
  const description = read("submission/GAME_DESCRIPTION.txt").trim();
  assert.ok(description.length > 30);
  assert.ok(description.length <= 200, `description=${description.length}`);
});

test("Codex 활용 설명은 폼 제한 5000자 이하다", () => {
  const process = read("submission/CODEX_PROCESS.md").trim();
  assert.ok(process.length > 500);
  assert.ok(process.length <= 5000, `codex process=${process.length}`);
});

test("공개 제출 문서에는 다른 AI 제품명이 노출되지 않는다", () => {
  const publicDocs = ["SUBMISSION.md", "FRONTIER-README.md", "submission/CODEX_PROCESS.md", "submission/RIGHTS_AND_ATTRIBUTION.md"];
  for (const path of publicDocs) {
    assert.doesNotMatch(read(path), /claude|anthropic|클로드|앤트로픽/i, path);
  }
});

test("썸네일은 16:9 PNG이며 10MB 이하다", () => {
  const url = new URL("../thumbnail.png", import.meta.url);
  const png = readFileSync(url);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assert.equal(width, 1920);
  assert.equal(height, 1080);
  assert.equal(width / height, 16 / 9);
  assert.ok(statSync(url).size <= 10 * 1024 * 1024);
});

test("공개 링크와 소셜 메타데이터가 현재 배포 주소를 가리킨다", () => {
  const html = read("index.html");
  const submission = read("SUBMISSION.md");
  const live = "https://anjungbeom.github.io/gamebuilder/";
  assert.match(html, new RegExp(`<link rel="canonical" href="${live}"`));
  assert.match(html, /property="og:image"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(submission, new RegExp(live));
  assert.doesNotMatch(submission, /anjungbeom\.github\.io\/drawn-frontier/);
});

test("웹 앱 매니페스트는 유효한 JSON이다", () => {
  const manifest = JSON.parse(read("manifest.webmanifest"));
  assert.equal(manifest.name, "Drawn Frontier");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.orientation, "landscape");
});
