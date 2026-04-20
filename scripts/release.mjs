#!/usr/bin/env node
/**
 * 版本发布脚本
 * 功能：交互式选择版本类型 → 更新 package.json → 构建 → git commit + tag + push
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { createInterface } from 'readline';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_PATH = resolve(__dirname, '../package.json');

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────

/** 执行命令并打印输出 */
function run(cmd, opts = {}) {
  console.log(`\n▶ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', ...opts });
}

/** 读取当前版本号 */
function readVersion() {
  const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf-8'));
  return pkg.version;
}

/** 计算下一个版本号 */
function bumpVersion(current, type) {
  const parts = current.split('.').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`无效的版本号格式: ${current}`);
  }
  const [major, minor, patch] = parts;
  switch (type) {
    case 'major': return `${major + 1}.0.0`;
    case 'minor': return `${major}.${minor + 1}.0`;
    case 'patch': return `${major}.${minor}.${patch + 1}`;
    default: throw new Error(`未知版本类型: ${type}`);
  }
}

/** 将新版本号写入 package.json */
function writeVersion(newVersion) {
  const raw = readFileSync(PKG_PATH, 'utf-8');
  const pkg = JSON.parse(raw);
  pkg.version = newVersion;
  // 保留原始缩进风格
  const indent = raw.match(/^(\s+)"/m)?.[1] ?? '  ';
  writeFileSync(PKG_PATH, JSON.stringify(pkg, null, indent.length) + '\n', 'utf-8');
}

/** 检查工作区是否有未提交的变更 */
function checkCleanWorkspace() {
  const status = execSync('git status --porcelain', { encoding: 'utf-8' });
  if (status.trim()) {
    console.error('\n❌ 工作区存在未提交的变更，请先 commit 或 stash：\n');
    console.error(status);
    process.exit(1);
  }
}

/** 检查远端分支是否可推送 */
function getCurrentBranch() {
  return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
}

// ──────────────────────────────────────────────
// 交互式询问
// ──────────────────────────────────────────────

const VERSION_TYPES = ['patch', 'minor', 'major', 'custom'];

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function selectVersionType(currentVersion) {
  const previews = VERSION_TYPES.slice(0, 3).map((t, i) => {
    const next = bumpVersion(currentVersion, t);
    return `  [${i + 1}] ${t.padEnd(6)} → ${next}`;
  });

  console.log(`\n当前版本: \x1b[36m${currentVersion}\x1b[0m`);
  console.log('\n请选择版本类型：');
  previews.forEach(p => console.log(p));
  console.log(`  [4] custom → 手动输入`);
  console.log(`  [0] 取消退出\n`);

  const choice = await prompt('请输入编号 [1-4] 或直接输入版本号: ');

  if (choice === '0' || choice === '') {
    console.log('已取消。');
    process.exit(0);
  }

  // 直接输入了版本号（如 2.0.0）
  if (/^\d+\.\d+\.\d+$/.test(choice)) {
    return choice;
  }

  const idx = parseInt(choice, 10) - 1;
  if (idx < 0 || idx > 3) {
    console.error('❌ 无效选项');
    process.exit(1);
  }

  if (idx === 3) {
    const custom = await prompt('请输入版本号 (格式: x.y.z): ');
    if (!/^\d+\.\d+\.\d+$/.test(custom)) {
      console.error('❌ 版本号格式不正确，需满足 x.y.z');
      process.exit(1);
    }
    return custom;
  }

  return bumpVersion(currentVersion, VERSION_TYPES[idx]);
}

async function confirmRelease(newVersion, branch) {
  const answer = await prompt(
    `\n即将发布 \x1b[33mv${newVersion}\x1b[0m 并推送到 \x1b[36m${branch}\x1b[0m，确认？[y/N] `
  );
  if (answer.toLowerCase() !== 'y') {
    console.log('已取消。');
    process.exit(0);
  }
}

// ──────────────────────────────────────────────
// 主流程
// ──────────────────────────────────────────────

async function main() {
  // 1. 确认工作区干净
  checkCleanWorkspace();

  const currentVersion = readVersion();
  const branch = getCurrentBranch();

  // 2. 选择新版本
  const newVersion = await selectVersionType(currentVersion);

  // 3. 二次确认
  await confirmRelease(newVersion, branch);

  // 4. 更新 package.json
  console.log(`\n✅ 更新版本号: ${currentVersion} → ${newVersion}`);
  writeVersion(newVersion);

  // 5. 构建
  console.log('\n📦 构建项目...');
  run('pnpm run build');

  // 6. Git 提交 + tag
  run(`git add package.json`);
  run(`git commit -m "chore: release v${newVersion}"`);
  run(`git tag v${newVersion}`);

  // 7. 推送代码和 tag
  run(`git push origin ${branch}`);
  run(`git push origin v${newVersion}`);

  console.log(`\n🎉 版本 \x1b[32mv${newVersion}\x1b[0m 已成功发布到远端！`);
  console.log(`\n下一步可运行：\x1b[90mnpm publish --access=public\x1b[0m`);
}

main().catch(err => {
  console.error('\n❌ 发布失败：', err.message);
  process.exit(1);
});
