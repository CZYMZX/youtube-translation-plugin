import fs from 'fs';
import readline from 'readline';
import path from 'path';

/**
 * 自动导出当前 Antigravity 会话记录为结构化 Markdown
 */
async function exportConversation() {
  const convId = 'e1d767d1-e0c6-46d5-8856-e837f406f4c9';
  const transcriptPath = `C:\\Users\\ASUS\\.gemini\\antigravity\\brain\\${convId}\\.system_generated\\logs\\transcript_full.jsonl`;
  const projectRoot = path.resolve('.');
  const outDir = path.join(projectRoot, 'docs', 'conversations');

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  if (!fs.existsSync(transcriptPath)) {
    console.error('Transcript file not found at:', transcriptPath);
    return;
  }

  const fileStream = fs.createReadStream(transcriptPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const turns = [];
  let currentTurn = null;

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'USER_INPUT') {
        const text = typeof obj.content === 'string' ? obj.content : JSON.stringify(obj.content);
        if (!text.includes('<SYSTEM_MESSAGE>') && !text.includes('Wait for')) {
          if (currentTurn) {
            turns.push(currentTurn);
          }
          currentTurn = {
            step_index: obj.step_index,
            created_at: obj.created_at,
            user: text.replace(/<USER_REQUEST>/g, '').replace(/<\/USER_REQUEST>/g, '').trim(),
            assistant: ''
          };
        }
      } else if (obj.type === 'PLANNER_RESPONSE' && currentTurn) {
        if (typeof obj.content === 'string' && obj.content.trim()) {
          currentTurn.assistant = obj.content.trim();
        }
      }
    } catch (e) {}
  }

  if (currentTurn) {
    turns.push(currentTurn);
  }

  let md = `# YouTube 智能双语断句与翻译扩展 - 开发对话与技术决策全量归档\n\n`;
  md += `> 本文档完整记录了从零需求设计、架构拆分、断句算法实现、多源翻译集成、Edge 浏览器自动化排查到歌枠空字幕轨攻坚的全过程。\n`;
  md += `> 同步时间：${new Date().toLocaleString('zh-CN')}\n\n---\n\n`;

  turns.forEach((turn, idx) => {
    md += `## 轮次 ${idx + 1} (${turn.created_at || '时间未记录'})\n\n`;
    md += `### 👤 用户需求 / 输入\n\n`;
    md += `\`\`\`text\n${turn.user}\n\`\`\`\n\n`;
    md += `### 🤖 Antigravity 响应与实现方案\n\n`;
    md += `${turn.assistant || '（该轮次主要执行自动化任务与工具调用）'}\n\n`;
    md += `---\n\n`;
  });

  const mdPath = path.join(outDir, 'CONVERSATION_HISTORY.md');
  fs.writeFileSync(mdPath, md, 'utf-8');
  console.log(`[Success] Updated: ${mdPath} (${turns.length} turns)`);

  fs.copyFileSync(transcriptPath, path.join(outDir, 'transcript_raw.jsonl'));
}

exportConversation().catch(console.error);
