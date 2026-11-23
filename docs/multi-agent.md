# 多代理作战手册 / Multi-agent runbook

四个 preset 组成流水线，工具面在 preset 层**物理隔离**（不是靠人格自觉）。

| Preset | 角色 | 能做 | 不能做 |
|---|---|---|---|
| `VAPT mode` | 全流程 | 全部 17 个工具 | — |
| `VAPT recon mode` | 侦察 | brief / scope_check / asset_add / tool_list / tool_run / findings_list / slot | **无 finding_add**（写不了结论） |
| `VAPT verify mode` | 复现取证 | finding_add / evidence_add / poc_add / screenshot / tool_run / report / slot | 无 credentialed 工具 |
| `VAPT report mode` | 出报告 | status / findings_list / credential_list / report | **无扫描/写入**（只读） |

## 标准流程

```
1. 主会话（VAPT mode）
   vapt_engagement_open client:"ACME" scope:["10.10.0.0/24"] window:"2026-11-21~28"
   vapt_brief                       # 范围/预算/规则
   vapt_slot action:"status"        # 看还有几个执行名额

2. 派 recon 子代理（preset: VAPT recon mode）
   任务书写清：范围、已测过什么、期望产出（资产写入）、你是叶子节点
   子代理：vapt_slot acquire → vapt_tool_run … → vapt_asset_add → vapt_slot release

3. 派 verify 子代理（preset: VAPT verify mode）
   输入：recon 给的线索 → 最小动作复现 → finding_add(confirmed/observed)
   → vapt_poc_add 存重放请求 → vapt_screenshot 截图 → release

4. 主会话核对（vapt_findings_list / vapt_status）
5. 派 report 子代理（preset: VAPT report mode）
   status / findings_list → 指出缺证据的条目 → vapt_report
```

## 并发闸门（`vapt_slot`）

- 同一靶最多 **3** 个执行智能体（`VAPT_MAX_AGENTS`，硬上限 6）
- 租约文件 `$DSH_HOME/vapt/slots.json`，30 分钟 TTL，文件锁防并发写
- 拿不到名额（`ok:false, reason:"full"`）**不要重试硬塞**，等现有子代理回报
- 子代理结束必须 `release`，否则 30 分钟后才自动回收

## 为什么要白名单

`recon` 拿不到 `finding_add`，就不可能把「扫描器命中」写成「已确认漏洞」；
`report` 拿不到 `tool_run`，就不可能「顺手补测一下」。
这是把流程约束放在**能力层**而不是提示词层——和 scope 校验同一个思路。
