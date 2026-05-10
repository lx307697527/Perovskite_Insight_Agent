# 项目术语表

本文档统一 PIA 项目中的专业术语、缩写、变量命名。

---

## 钙钛矿领域术语

### 性能指标

| 术语 | 全称 | 中文 | 含义 | 单位 | 合理范围 |
|------|------|------|------|------|----------|
| **PCE** | Power Conversion Efficiency | 光电转换效率 | 太阳能电池将光能转换为电能的效率 | % | 0-30% |
| **Voc** | Open-Circuit Voltage | 开路电压 | 无负载时的电压 | V | 0-2V |
| **Jsc** | Short-Circuit Current Density | 短路电流密度 | 短路时的电流密度 | mA/cm² | 0-30 mA/cm² |
| **FF** | Fill Factor | 填充因子 | 实际最大功率与理论最大功率的比值 | % | 0-100% |
| **SPO** | Steady-State Power Output | 稳态功率输出 | 稳定工作状态下的输出功率 | - | - |

### 器件结构

| 术语 | 中文 | 含义 | 示例 |
|------|------|------|------|
| **n-i-p** | 正式结构 | 电子传输层在底部 | Glass/FTO/TiO₂/Perovskite/HTM/Au |
| **p-i-n** | 反式结构 | 空穴传输层在底部 | Glass/ITO/PEDOT:PSS/Perovskite/PCBM/Ag |
| **ETL** | Electron Transport Layer | 电子传输层 | TiO₂, SnO₂, ZnO |
| **HTL** / **HTM** | Hole Transport Layer/Material | 空穴传输层/材料 | Spiro-OMeTAD, PTAA, NiOx |

### 钙钛矿组分

| 术语 | 全称 | 中文 | 化学式 |
|------|------|------|--------|
| **MA** | Methylammonium | 甲胺 | CH₃NH₃⁺ |
| **FA** | Formamidinium | 甲脒 | HC(NH₂)₂⁺ |
| **Cs** | Cesium | 铯 | Cs⁺ |
| **Rb** | Rubidium | 铷 | Rb⁺ |
| **GA** | Guanidinium | 胍 | C(NH₂)₃⁺ |

**命名规范**：
- 单阳离子：`FAPbI3`, `MAPbBr3`
- 混合阳离子：`Cs0.05FA0.85MA0.1PbI3`（下标表示比例）
- 简写：`CsFAMAPbI3`（省略比例）

### 卤素

| 符号 | 英文 | 中文 | 用途 |
|------|------|------|------|
| **I** | Iodine | 碘 | 最常用，窄带隙 |
| **Br** | Bromine | 溴 | 宽带隙，用于叠层电池 |
| **Cl** | Chlorine | 氯 | 掺杂，改善结晶 |

### 工艺参数

| 术语 | 中文 | 含义 | 典型值 |
|------|------|------|--------|
| **Spin-coating** | 旋涂 | 制备薄膜的方法 | 3000-6000 rpm, 30-60s |
| **Annealing** | 退火 | 热处理改善结晶 | 100-150°C, 10-60 min |
| **Antisolvent** | 反溶剂 | 促进结晶的溶剂 | CB, DE, Toluene |
| **Passivation** | 钝化 | 减少缺陷 | PEAI, BAI |
| **Additive** | 添加剂 | 改善性能的物质 | PbI₂, MAI, DMSO |

**常用溶剂**：
- **DMF** (Dimethylformamide) - 二甲基甲酰胺
- **DMSO** (Dimethyl sulfoxide) - 二甲基亚砜
- **GBL** (Gamma-butyrolactone) - γ-丁内酯
- **NMP** (N-Methyl-2-pyrrolidone) - N-甲基吡咯烷酮

### 稳定性测试协议

| 协议 | 全称 | 测试条件 |
|------|------|----------|
| **ISOS-D-1** | Dark, ambient | 室温，黑暗，环境气氛 |
| **ISOS-D-2** | Dark, controlled | 室温，黑暗，惰性气氛 |
| **ISOS-L-1** | Light, ambient | 光照，室温，环境气氛 |
| **ISOS-L-2** | Light, controlled | 光照，室温，惰性气氛 |
| **ISOS-L-3** | Light, high temp | 光照，高温，惰性气氛 |

**稳定性指标**：
- **T80**：效率降至初始值 80% 的时间
- **T90**：效率降至初始值 90% 的时间

---

## 项目代码术语

### 数据模型

| 术语 | 含义 | 示例 |
|------|------|------|
| `doi` | Digital Object Identifier，论文唯一标识符 | `10.1126/science.abc1234` |
| `metrics` | 性能指标数据 | PCE, Voc, Jsc, FF |
| `process` | 工艺参数 | 旋涂速度、退火温度 |
| `evidence` | 数据溯源证据 | 原文中的具体句子或表格 |
| `composition` | 钙钛矿组分 | Cs0.05FA0.85MA0.1PbI3 |

### API 术语

| 术语 | 含义 | 使用场景 |
|------|------|----------|
| `extraction` | 参数提取过程 | 从 PDF 中提取工艺参数 |
| `parsing` | 解析过程 | PDF 转为结构化数据 |
| `search` | 检索 | 语义搜索文献 |
| `cached` | 已缓存 | 命中本地缓存 |

### 状态术语

| 术语 | 含义 | 上下文 |
|------|------|--------|
| `pending` | 等待中 | 任务队列中 |
| `running` | 运行中 | 任务执行中 |
| `completed` | 已完成 | 任务成功完成 |
| `failed` | 失败 | 任务执行失败 |

---

## 技术栈术语

### 前端

| 缩写 | 完整形式 | 含义 |
|------|----------|------|
| **SSE** | Server-Sent Events | 服务器推送事件 |
| **API** | Application Programming Interface | 应用程序接口 |
| **UI** | User Interface | 用户界面 |
| **UX** | User Experience | 用户体验 |

### 后端

| 缩写 | 完整形式 | 含义 |
|------|----------|------|
| **WAL** | Write-Ahead Logging | 预写式日志（SQLite 模式） |
| **JSON** | JavaScript Object Notation | 数据交换格式 |
| **HTTP** | HyperText Transfer Protocol | 超文本传输协议 |

### AI 相关

| 术语 | 含义 | 使用场景 |
|------|------|----------|
| **Pipeline** | 处理流水线 | 两阶段 AI Pipeline |
| **Token** | 文本单元 | API 计费单位 |
| **Prompt** | 提示词 | 给 AI 的指令 |
| **Context** | 上下文 | AI 可用的信息范围 |

---

## 变量命名约定

### 前端命名

| 类型 | 约定 | 示例 |
|------|------|------|
| 组件 | PascalCase | `HomePage`, `ResultsPage` |
| 函数 | camelCase | `handleSearch`, `fetchDetails` |
| 常量 | UPPER_SNAKE_CASE | `API_BASE`, `MAX_RETRIES` |
| 接口 | PascalCase + 前缀 I | `Literature`, `SearchResult` |
| Hook | use 前缀 | `useSSE`, `useLocalStorage` |

### 后端命名

| 类型 | 约定 | 示例 |
|------|------|------|
| 类 | PascalCase | `TaskManager`, `PDFExtractor` |
| 函数 | snake_case | `extract_metrics`, `parse_composition` |
| 常量 | UPPER_SNAKE_CASE | `DB_PATH`, `TIMEOUT_SECONDS` |
| 变量 | snake_case | `search_results`, `task_id` |

### 数据库命名

| 类型 | 约定 | 示例 |
|------|------|------|
| 表 | snake_case（复数） | `papers`, `metrics` |
| 列 | snake_case | `created_at`, `scan_direction` |
| 索引 | idx_ 前缀 | `idx_doi`, `idx_created_at` |

---

## 期刊缩写

| 缩写 | 全称 | 中文 |
|------|------|------|
| **Nature/Science** | Nature / Science | 自然 / 科学 |
| **JACS** | Journal of the American Chemical Society | 美国化学会志 |
| **Angew** | Angewandte Chemie | 应用化学 |
| **AEM** | Advanced Energy Materials | 先进能源材料 |
| **AFM** | Advanced Functional Materials | 先进功能材料 |
| **EES** | Energy & Environmental Science | 能源与环境科学 |
| **Joule** | Joule | 焦耳 |
| **NM** | Nature Materials | 自然材料 |
| **NE** | Nature Energy | 自然能源 |

---

## 机构缩写

| 缩写 | 全称 | 中文 |
|------|------|------|
| **NREL** | National Renewable Energy Laboratory | 美国国家可再生能源实验室 |
| **EPFL** | École Polytechnique Fédérale de Lausanne | 洛桑联邦理工学院 |
| **MIT** | Massachusetts Institute of Technology | 麻省理工学院 |
| **Oxford** | University of Oxford | 牛津大学 |
| **SJTU** | Shanghai Jiao Tong University | 上海交通大学 |

---

## 术语使用规范

### 文档中的使用

1. **首次出现**：完整术语 + 缩写
   ```
   光电转换效率 (Power Conversion Efficiency, PCE)
   ```

2. **后续使用**：直接使用缩写
   ```
   PCE 达到 25.1%
   ```

### 代码中的使用

1. **变量命名**：使用英文全称或标准缩写
   ```typescript
   // ✅ 推荐
   const powerConversionEfficiency = 25.1;
   const pce = 25.1;

   // ❌ 避免
   const xiaolv = 25.1;  // 拼音
   ```

2. **注释**：可以使用中文解释
   ```python
   # 提取光电转换效率 (PCE)
   def extract_pce(text: str) -> float:
       pass
   ```

---

## 常见错误纠正

| ❌ 错误 | ✅ 正确 | 说明 |
|--------|--------|------|
| Voc | Voc 或 VOC | 首字母大写，或全大写 |
| Jsc | Jsc 或 JSC | 首字母大写，或全大写 |
| MAI | MAI 或 MA⁺ | 离子状态用上标 |
| FAI | FAI 或 FA⁺ | 离子状态用上标 |
| n-i-p | n-i-p 或 nip | 保持连字符或省略 |
| p-i-n | p-i-n 或 pin | 保持连字符或省略 |

---

## 术语更新流程

当项目中出现新术语时：

1. 在本文档中添加术语定义
2. 更新相关代码注释
3. 在 CLAUDE.md 中引用本文档
4. Code Review 时检查术语使用是否规范
