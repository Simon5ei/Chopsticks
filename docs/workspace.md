# 工作区与插件候选链路

当前机器开发工作区是 `/root/workspace/dsh`，运行代码仍在 `/opt/chopsticks`，私有运行配置和角色数据在 `/var/lib/chopsticks`。

| 内容 | 正式路径 |
|---|---|
| 开发项目 | `/root/workspace/dsh/projects/` |
| 笔记 | `/root/workspace/dsh/notes/` |
| 候选视频清单 | `/root/workspace/dsh/bili-watch/fish-dsh-plugins.csv` |
| 扫描报告 | `/root/workspace/dsh/bili-watch/candidates-latest.md` |
| 候选扫描器 | `/root/workspace/dsh/scripts/scan-plugins.mjs` |

候选清单没有表头，两列分别是视频地址和参考意见。扫描器只追加新视频，保留已有批注。脚本通过 `/var/lib/chopsticks/config.json` 的 `fishHome` 定位凭据，不导入 SurfCore；默认工作区取脚本目录的上一级，可通过 `CHOPSTICKS_WORKSPACE` 显式覆盖。

北京时间 09:00 的 Codex 调研任务读取正式清单，联网研究并在独立会话提交待审报告。10:00 的服务器 cron 只扫描视频候选、追加清单。两者均不直接安装插件，安装仍须管理员批准具体插件及版本。`--dry` 扫描不会写入清单和报告。

旧工作区已于 2026-11-03 从原路径移入 `/opt/chopsticks-backups/legacy-links-20261103-030243/surfcore-workspace`，不再作为活跃入口或缺失时的回退。同一备份包含清理前的新工作区和 root crontab，可用于恢复。

原始会话日志目录名、历史命令回执、迁移脚本以及许可证说明可能仍出现旧产品名称。这些是历史身份或来源记录，不是活跃扫描依赖；不能通过批量替换来改变会话标识或抹去事实。
