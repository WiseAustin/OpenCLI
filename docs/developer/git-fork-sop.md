# Git Fork Maintenance SOP

> 本文记录当前仓库作为开源项目 fork 的长期维护流程。适用于 `WiseAustin/OpenCLI` 在本地基于 `jackwener/opencli` 做二次开发。

## 分支和远端约定

本仓库按三层模型维护：

| 名称 | 作用 | 是否做定制开发 |
|---|---|---|
| `upstream/main` | 开源项目源头：`jackwener/opencli` | 否 |
| `origin/main` | 个人 fork 的上游镜像：`WiseAustin/OpenCLI` | 否 |
| `custom/main` | 长期二次开发分支 | 是 |

远端应保持为：

```bash
git remote -v
```

期望结果：

```text
origin    https://github.com/WiseAustin/OpenCLI.git
upstream  https://github.com/jackwener/opencli.git
```

## 基本原则

- `main` 只跟开源项目同步，不在 `main` 上做业务定制。
- 所有本地定制进入 `custom/main` 或从它切出的 `feature/*` 分支。
- 每次同步开源更新前，先保证当前工作区干净。
- 不提交 `.env`、导出数据、浏览器缓存、`node_modules/`、`dist/` 等本地产物。
- 生成文件优先通过项目脚本生成，不手工大改 `cli-manifest.json`。
- 变基后必须跑最小验证，再推送。

## 日常同步开源更新

```bash
git fetch upstream --prune

git switch main
git merge --ff-only upstream/main
git push origin main

git switch custom/main
git rebase main
```

如果 rebase 没有冲突，继续验证并推送：

```bash
npm run build
npx vitest run --project adapter clis/zsxq/footprint.test.js

git push --force-with-lease origin custom/main
```

说明：

- `main` 使用 `--ff-only`，确保它永远是上游的干净镜像。
- `custom/main` 使用 `rebase main`，让本地定制保持在最新上游之上。
- rebase 后推送需要 `--force-with-lease`，不要使用裸 `--force`。

## 新增定制开发

小改可以直接在 `custom/main` 上提交；较大的改动建议切 feature 分支：

```bash
git switch custom/main
git pull --rebase
git switch -c feature/<short-name>
```

完成改动后：

```bash
git status --short
git diff --stat

npm run build
npx vitest run <相关测试文件>

git add <明确文件列表>
git commit -m "feat(scope): concise summary"
git push -u origin feature/<short-name>
```

确认后再合回 `custom/main`：

```bash
git switch custom/main
git merge --ff-only feature/<short-name>
git push origin custom/main
```

## 当前定制基线

截至 2026-05-11，当前 `custom/main` 相对开源最新 `main` 只有一个定制提交：

```text
60eaba08 feat(zsxq): add member footprint export
```

它包含：

- `clis/zsxq/footprint.js`
- `clis/zsxq/footprint.test.js`
- `clis/zsxq/utils.js` 的小改
- `docs/adapters/browser/zsxq.md`
- `cli-manifest.json` 中 `zsxq footprint` 注册
- `.gitignore` 对 `.env` 和 `exports/` 的保护
- `scripts/sync-yaml.mjs`

## 合并冲突处理

优先级：

1. 保留上游最新代码结构。
2. 只把本地定制重新套到最新结构上。
3. `cli-manifest.json` 优先重新生成，不手工保留大块冲突。
4. `clis/zsxq/utils.js` 这类共享文件只保留必要小改。
5. 冲突解决后必须运行构建和相关测试。

常用排查：

```bash
git status --short
git diff --name-only --diff-filter=U
git diff
```

继续 rebase：

```bash
git add <已解决文件>
git rebase --continue
```

如果冲突处理方向明显不对：

```bash
git rebase --abort
```

## 推送和认证

首次推送前确认 GitHub CLI 已登录：

```bash
gh auth status
```

如未登录：

```bash
gh auth login
```

选择：

- `GitHub.com`
- `HTTPS`
- `Login with a web browser`

完成浏览器授权后再推送：

```bash
git push origin main
git push -u origin custom/main
```

如果 rebase 过 `custom/main`：

```bash
git push --force-with-lease origin custom/main
```

## 最小验证清单

每次同步或定制改动后至少做：

```bash
npm run build
```

涉及 `zsxq footprint` 时再做：

```bash
npx vitest run --project adapter clis/zsxq/footprint.test.js
```

如果 `npm install` 在 Windows 上被 `prepare` 脚本卡住，可以只同步依赖：

```bash
npm install --ignore-scripts
```

随后单独运行构建。

## 禁止事项

- 不在 `main` 上提交二次开发。
- 不提交 `.env` 或任何密钥、令牌、私钥。
- 不把 `exports/` 里的导出数据推到 GitHub。
- 不用 `git reset --hard`、`git clean -fdx` 处理冲突，除非明确确认风险。
- 不用裸 `git push --force`。
