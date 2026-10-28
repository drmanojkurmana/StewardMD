# design-guide v0.1.4

`v0.1.4` 打磨更名细节——修复最后一个遗留旧命名，对齐元数据。

## 变更

- **HTTP header**：预览服务器中 `X-F-Design-Token` → `X-Design-Guide-Token`。
- **发布日期**：`design-guide.json` 元数据同步更新。

## 升级方式

```bash
git pull --ff-only
bash scripts/sync-aide.sh
python3 scripts/design-guide-doctor.py --strict
```


# design-guide v0.1.3

`v0.1.3` 完成从 `f-design` 到 `design-guide` 的全面更名——代码、配置、仓库，全部同步。

## 主要变更

- **环境变量**：`F_DESIGN_*` → `DESIGN_GUIDE_*`，全部统一。
- **内部标识**：模块名、标记名、测试固件全部更新。
- **GitHub 仓库**：`GrubbyLee/f-design` → `GrubbyLee/design-guide`。
- **Gitee 镜像**：`synovation/f-design` → `synovation/design-guide`。
- **ClawHub 技能**：`f-design` → `design-guide`（旧 slug 自动重定向）。

## 升级方式

```bash
git pull --ff-only
bash scripts/sync-aide.sh
python3 scripts/design-guide-doctor.py --strict
```


# design-guide v0.1.2

`v0.1.2` 是一个命名一致性补丁版本，将显示名称、配置目录以及全部文档与 `design-guide` 品牌统一对齐。

## 主要变更

- **显示名称**：SKILL.md 标题由 "F Design" 改为 "Design Guide"（修复 ClawHub 技能卡片名称）。
- **配置目录**：所有引用统一为 `.design-guide/` 作为项目偏好路径。
- **清单文件**：`design-guide.json` 版本升至 `0.1.2`。

## 升级方式

```bash
git pull --ff-only
bash scripts/sync-aide.sh
python3 scripts/design-guide-doctor.py --strict
```


# design-guide v0.1.1

`v0.1.1` 是一次修复发布，保留 `v0.1.0` 的完整设计到实现工作流，并加强发布完整性、密钥扫描、版本一致性和跨 AIDE 同步安全。

升级命令：

```bash
git pull --ff-only
bash scripts/sync-aide.sh
python3 scripts/design-guide-doctor.py --strict
```
