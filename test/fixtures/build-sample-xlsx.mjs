#!/usr/bin/env node
// Generates test/fixtures/sample.xlsx — a minimal, valid workbook with two
// sheets. Run once, commit the output.
//
// Used by the document-parser unit test as a self-contained fixture so the
// toolkit's tests run from a standalone clone. The workbook is written with
// exceljs (already a dependency, the same library the parser reads it with)
// and covers the cell-value shapes the xlsx layout must normalize:
//   - 「员工名单」: a plain 3-column Chinese data table with enough rows that
//     the ≤380-character row-group budget forces MULTIPLE groups, exercising
//     the header-repetition contract.
//   - 「统计数据」: numbers, booleans, a date, a formula with a cached result,
//     rich text, a `|` that must be escaped, and an embedded newline that must
//     fold to a space.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const workbook = new ExcelJS.Workbook();

const roster = workbook.addWorksheet('员工名单');
roster.addRow(['姓名', '部门', '职责']);
roster.addRow(['张伟', '平台工程部', '负责中文检索流水线的分层切片策略与向量索引构建，并牵头制定解析层的接口契约']);
roster.addRow(['王芳', '数据智能部', '维护评测数据集并跟踪召回率与重排序指标的长期趋势，定期产出质量回归报告']);
roster.addRow(['李强', '基础架构部', '保障向量数据库与倒排索引服务的高可用与容量规划，负责故障演练与预案沉淀']);
roster.addRow(['刘洋', '产品设计部', '梳理知识库问答场景的需求并验证引用定位的准确性，沉淀可复用的验收用例集']);
roster.addRow(['陈静', '平台工程部', '实现文档解析层的多格式接入与失败路径的可观测性，维护摄入侧的错误码字典']);
roster.addRow(['杨帆', '数据智能部', '构建混合检索的查询改写模块并评估中文分词的影响，跟进难例的归因与修复']);
roster.addRow(['赵磊', '基础架构部', '负责模型推理服务的部署编排与冷启动延迟的优化，管理推理侧的灰度发布流程']);
roster.addRow(['孙敏', '产品设计部', '设计表格问答的交互流程并收集一线用户的反馈样本，整理高频问题的答案模板']);

const stats = workbook.addWorksheet('统计数据');
stats.addRow(['指标', '数值', '说明']);
stats.addRow(['接入服务数', 128, '含 A|B 两类内部服务']);
stats.addRow(['统计截止日', new Date(Date.UTC(2026, 2, 15)), '第一期\n第二期合并统计']);
stats.addRow(['服务数翻倍', { formula: 'B2*2', result: 256 }, '公式列应取缓存结果']);
stats.addRow(['指标已冻结', true, { richText: [{ text: '富' }, { text: '文本单元格' }] }]);

const out = await workbook.xlsx.writeBuffer();
const outPath = fileURLToPath(new URL('./sample.xlsx', import.meta.url));
writeFileSync(outPath, Buffer.from(out));
console.log(`wrote ${out.byteLength} bytes -> ${outPath}`);
