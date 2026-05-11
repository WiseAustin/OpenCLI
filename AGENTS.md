# Codex Agent Instructions

本仓库是 `jackwener/opencli` 的个人 fork 二次开发工作区。Codex 在本项目中操作时，必须先遵守 [Git Fork Maintenance SOP](docs/developer/git-fork-sop.md)。

## 当前仓库角色

- 开源源头：`upstream` -> `https://github.com/jackwener/opencli.git`
- 个人 fork：`origin` -> `https://github.com/WiseAustin/OpenCLI.git`
- 干净上游镜像：`main`
- 长期定制分支：`custom/main`

## 工作规则

- 默认在 `custom/main` 上做二次开发。
- 不在 `main` 上提交定制代码；`main` 只用于同步 `upstream/main`。
- 开始修改前先检查 `git status --short --branch` 和当前分支。
- 同步开源更新时按 SOP 执行：先快进 `main`，再 rebase `custom/main`。
- 提交前明确列出要进入提交的文件，不使用笼统的 `git add .`。
- 不提交 `.env`、`exports/`、`node_modules/`、`dist/`、本地日志或任何凭证。
- `cli-manifest.json` 是生成产物，除非是构建脚本生成后的必要差异，否则不要手工大范围修改。
- 推送 `custom/main` 的 rebase 结果时使用 `git push --force-with-lease origin custom/main`。

## 验证规则

- 普通改动至少运行 `npm run build`。
- 涉及 `zsxq footprint` 时运行：

```bash
npx vitest run --project adapter clis/zsxq/footprint.test.js
```

- 如果依赖安装在 Windows 上被 `prepare` 脚本阻塞，可按 SOP 使用 `npm install --ignore-scripts`，再单独运行构建。

## 沟通规则

- 默认中文输出。
- 先给结论，再给细节。
- 修改前说明要改哪些文件和原因。
- 遇到冲突、凭证、密钥、破坏性 Git 操作时先停下来说明风险。
