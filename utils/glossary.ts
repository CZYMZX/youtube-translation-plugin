/**
 * VTuber / hololive 术语库（v0.2.8）
 *
 * 来源说明（sourceType）：
 * - official：hololive 官方网站（hololive.hololivepro.com）官方表记
 * - wiki：维基百科（中文/日文）条目
 * - community：VTuber 直播业界通用说法（无单一定义页，按社区通行译法整理）
 *
 * 数据核对时间：2026-11-04。
 * 术语库版本号参与翻译缓存键：内容更新时 bump，旧缓存自动失效。
 */

export type GlossaryCategory = 'talent' | 'group' | 'game' | 'song' | 'term';

export interface GlossaryEntry {
  id: string;
  /** 日文原词（匹配主键） */
  ja: string;
  /** 推荐中文译名 */
  zh: string;
  /** 英文 / 罗马字表记 */
  en?: string;
  category: GlossaryCategory;
  source: string;
  sourceType: 'official' | 'wiki' | 'community';
  /**
   * v0.3.1：该词同时是高频日常词（如「修繕」= 修补房屋），单句出现不足以证明是游戏语境。
   * 标记后仅当同批文本命中 ≥2 条术语时才注入，避免把日常句强行套上游戏译名。
   */
  needsContext?: boolean;
}

/** 术语库版本（参与缓存键，内容变化必须 bump） */
export const GLOSSARY_VERSION = '2026-11-04.1';

const OFFICIAL_TALENTS = 'https://hololive.hololivepro.com/talents/';
const ZH_WIKI = 'https://zh.wikipedia.org/wiki/Hololive';
const OFFICIAL_MUSIC = 'https://hololive.hololivepro.com/music/';
const JA_WIKI_VTUBER = 'https://ja.wikipedia.org/wiki/バーチャルYouTuber';

/** 主播：[日文名, 中文名, 英文名]（均有官方表记 + 中文维基译名） */
const TALENTS: Array<[string, string, string]> = [
  // 0 期生
  ['ときのそら', '时乃空', 'Tokino Sora'],
  ['ロボ子さん', '萝卜子', 'Robocosan'],
  ['さくらみこ', '樱巫女', 'Sakura Miko'],
  ['星街すいせい', '星街彗星', 'Hoshimachi Suisei'],
  ['AZKi', 'AZKi', 'AZKi'],
  // 1 期生
  ['夜空メル', '夜空梅露', 'Yozora Mel'],
  ['白上フブキ', '白上吹雪', 'Shirakami Fubuki'],
  ['アキ・ローゼンタール', '亚绮·罗森塔尔', 'Aki Rosenthal'],
  ['夏色まつり', '夏色祭', 'Natsuiro Matsuri'],
  ['赤井はあと', '赤井心', 'Akai Haato'],
  // 2 期生
  ['湊あくあ', '凑阿库娅', 'Minato Aqua'],
  ['紫咲シオン', '紫咲诗音', 'Murasaki Shion'],
  ['百鬼あやめ', '百鬼绫目', 'Nakiri Ayame'],
  ['癒月ちょこ', '愈月巧可', 'Yuzuki Choco'],
  ['大空スバル', '大空昴', 'Oozora Subaru'],
  // GAMERS
  ['大神ミオ', '大神澪', 'Ookami Mio'],
  ['猫又おかゆ', '猫又小粥', 'Nekomata Okayu'],
  ['戌神ころね', '戌神沁音', 'Inugami Korone'],
  // 3 期生
  ['兎田ぺこら', '兔田佩克拉', 'Usada Pekora'],
  ['不知火フレア', '不知火芙蕾雅', 'Shiranui Flare'],
  ['白銀ノエル', '白银诺艾尔', 'Shirogane Noel'],
  ['宝鐘マリン', '宝钟玛琳', 'Houshou Marine'],
  ['潤羽るしあ', '润羽露西娅', 'Uruha Rushia'],
  // 4 期生
  ['天音かなた', '天音彼方', 'Amane Kanata'],
  ['桐生ココ', '桐生可可', 'Kiryu Coco'],
  ['角巻わため', '角卷绵芽', 'Tsunomaki Watame'],
  ['常闇トワ', '常暗永远', 'Tokoyami Towa'],
  ['姫森ルーナ', '姬森璐娜', 'Himemori Luna'],
  // 5 期生
  ['雪花ラミィ', '雪花菈米', 'Yukihana Lamy'],
  ['桃鈴ねね', '桃铃音音', 'Momosuzu Nene'],
  ['獅白ぼたん', '狮白牡丹', 'Shishiro Botan'],
  ['尾丸ポルカ', '尾丸波尔卡', 'Omaru Polka'],
  // 6 期生 holoX
  ['ラプラス・ダークネス', '拉普拉斯·暗黑', 'La+ Darknesss'],
  ['鷹嶺ルイ', '鹰岭琉依', 'Takane Lui'],
  ['博衣こより', '博衣小夜璃', 'Hakui Koyori'],
  ['風真いろは', '风真伊吕波', 'Kazama Iroha'],
  ['沙花叉クロヱ', '沙花叉克萝伊', 'Sakamata Chloe'],
  // アソビ★まわり隊！
  ['熱千めら', '热千梅拉', 'Achichi Mela'],
  ['宙科そぴあ', '宙科索比亚', 'Sorashina Sopia'],
  ['鈴鳴つづり', '铃鸣缀', 'Suzuna Tsuzuri'],
  ['百灯キョーコ', '百灯京子', 'Hyakuto Kyoko'],
  // DEV_IS ReGLOSS
  ['音乃瀬奏', '音乃濑奏', 'Otonose Kanade'],
  ['一条莉々華', '一条莉莉华', 'Ichijou Ririka'],
  ['火威青', '火威青', 'Hiodoshi Ao'],
  ['儒烏風亭らでん', '儒乌风亭螺钿', 'Juufuutei Raden'],
  ['轟はじめ', '轰一', 'Todoroki Hajime'],
  // DEV_IS FLOW GLOW
  ['響咲リオナ', '响咲莉欧娜', 'Isaki Riona'],
  ['虎金妃笑虎', '虎金妃笑虎', 'Koganei Niko'],
  ['水宮枢', '水宫枢', 'Mizumiya Su'],
  ['輪堂千速', '轮堂千速', 'Rindo Chihaya'],
  ['綺々羅々ヴィヴィ', '绮绮罗罗薇薇', 'Kikirara Vivi'],
  // hololive Indonesia
  ['アユンダ・リス', '阿芸达·栗丝', 'Ayunda Risu'],
  ['ムーナ・ホシノヴァ', '暮娜·惑星诺瓦', 'Moona Hoshinova'],
  ['アイラニ・イオフィフティーン', '艾拉妮·伊欧菲芙婷', 'Airani Iofifteen'],
  ['クレイジー・オリー', '克蕾西·奥莉', 'Kureiji Ollie'],
  ['アーニャ・メルフィッサ', '阿妮娅·梅尔菲莎', 'Anya Melfissa'],
  ['パヴォリア・レイネ', '帕沃莉亚·蕾内', 'Pavolia Reine'],
  ['ベスティア・ゼータ', '维斯提亚·泽塔', 'Vestia Zeta'],
  ['カエラ・コヴァルスキア', '卡埃拉·科瓦尔斯基亚', 'Kaela Kovalskia'],
  ['こぼ・かなえる', '可波·卡娜埃露', 'Kobo Kanaeru'],
  // hololive English
  ['森カリオペ', '森美声', 'Mori Calliope'],
  ['小鳥遊キアラ', '小鸟游琪亚拉', 'Takanashi Kiara'],
  ['一伊那尓栖', '一伊那尔栖', "Ninomae Ina'nis"],
  ['がうる・ぐら', '噶呜·古拉', 'Gawr Gura'],
  ['ワトソン・アメリア', '沃森·阿米莉亚', 'Watson Amelia'],
  ['IRyS', 'IRyS', 'IRyS'],
  ['セレス・ファウナ', '塞莱希·法娜', 'Ceres Fauna'],
  ['九十九佐命', '九十九佐命', 'Tsukumo Sana'],
  ['ハコス・ベールズ', '哈珂斯·贝尔丝', 'Hakos Baelz'],
  ['オーロ・クロニー', '奥罗·克洛尼', 'Ouro Kronii'],
  ['七詩ムメイ', '七诗无铭', 'Nanashi Mumei'],
  ['シオリ・ノヴェラ', '诗织·诺薇拉', 'Shiori Novella'],
  ['古石ビジュー', '古石碧珠', 'Koseki Bijou'],
  ['ネリッサ・レイヴンクロフト', '纳瑞莎·雷文克罗夫特', 'Nerissa Ravencroft'],
  ['フワワ・アビスガード', '软软·阿比斯加德', 'Fuwawa Abyssgard'],
  ['モココ・アビスガード', '茸茸·阿比斯加德', 'Mococo Abyssgard'],
  ['エリザベス・ローズ・ブラッドフレイム', '伊丽莎白·露丝·布拉德弗雷姆', 'Elizabeth Rose Bloodflame'],
  ['ジジ・ムリン', '琪琪·沐林', 'Gigi Murin'],
  ['セシリア・イマーグリーン', '塞西莉亚·伊默格林', 'Cecilia Immergreen'],
  ['ラオーラ・パンテーラ', '拉欧拉·潘特拉', 'Raora Panthera']
];

/** 团体 / 期别 / 组合 */
const GROUPS: Array<[string, string, string?]> = [
  ['ホロライブ', 'hololive（女子团体）', 'hololive'],
  ['ホロライブプロダクション', 'hololive production（事务所）', 'hololive production'],
  ['ホロスターズ', 'Holostars（男子团体）', 'Holostars'],
  ['hololive English', 'hololive 英语分部', 'hololive English'],
  ['hololive Indonesia', 'hololive 印尼分部', 'hololive Indonesia'],
  ['hololive DEV_IS', 'hololive DEV_IS', 'hololive DEV_IS'],
  ['ReGLOSS', 'ReGLOSS', 'ReGLOSS'],
  ['FLOW GLOW', 'FLOW GLOW', 'FLOW GLOW'],
  ['アソビ★まわり隊', 'アソビ★まわり隊（新组合）', 'Asobi Mawari Tai'],
  ['holoX', '秘密结社 holoX', 'holoX'],
  ['NePoLaBo', 'NePoLaBo（5期生）', 'NePoLaBo'],
  ['hololive Fantasy', 'hololive Fantasy（3期生）', 'hololive Fantasy'],
  ['holoForce', 'holoForce（4期生）', 'holoForce'],
  ['HoloMyth', 'HoloMyth（EN 1期）', 'HoloMyth'],
  ['HoloPromise', 'HoloPromise（EN）', 'HoloPromise'],
  ['HoloAdvent', 'HoloAdvent（EN 3期）', 'HoloAdvent'],
  ['HoloJustice', 'HoloJustice（EN 4期）', 'HoloJustice'],
  ['hololive GAMERS', 'hololive GAMERS', 'hololive GAMERS'],
  ['ホロのぐらふぃてぃ', 'holo的涂鸦（Holo no Graffiti）', 'Holo no Graffiti']
];

/** 游戏：[日文通称, 中文官方名, 英文名] */
const GAMES: Array<[string, string, string]> = [
  ['マインクラフト', '《我的世界》', 'Minecraft'],
  ['マイクラ', '《我的世界》', 'Minecraft'],
  ['APEX', '《Apex 英雄》', 'Apex Legends'],
  ['エーペックス', '《Apex 英雄》', 'Apex Legends'],
  ['ARK', '《方舟：生存进化》', 'ARK: Survival Evolved'],
  ['ヴァロラント', '《无畏契约》', 'VALORANT'],
  ['VALORANT', '《无畏契约》', 'VALORANT'],
  ['スプラトゥーン', '《斯普拉遁》', 'Splatoon'],
  ['モンハン', '《怪物猎人》', 'Monster Hunter'],
  ['ポケモン', '《宝可梦》', 'Pokémon'],
  ['原神', '《原神》', 'Genshin Impact'],
  ['エルデンリング', '《艾尔登法环》', 'Elden Ring'],
  ['マリオカート', '《马力欧卡丁车》', 'Mario Kart'],
  ['あつまれ どうぶつの森', '《集合啦！动物森友会》', 'Animal Crossing: New Horizons'],
  ['Among Us', '《我们之中》', 'Among Us'],
  ['Fall Guys', '《糖豆人》', 'Fall Guys']
];

/** 歌曲（hololive 官方音乐页收录，含演唱者） */
const SONGS: Array<[string, string, string]> = [
  ['Pong de Ding', 'Pong de Ding（萝卜子）', 'Robocosan'],
  ['Mirror Mirror', 'Mirror Mirror（Hakos Baelz）', 'Hakos Baelz'],
  ['せんしゅセンセーション', 'せんしゅセンセーション（夏色祭）', 'Natsuiro Matsuri'],
  ['推したら引けない恋でした', '推したら引けない恋でした（博衣小夜璃/AZKi/雪花菈米）', 'Hakui Koyori, AZKi, Yukihana Lamy'],
  ['果てない旅', '果てない旅（轮堂千速）', 'Rindo Chihaya'],
  ['ゾンビゾンビゾンビ', 'ゾンビゾンビゾンビ（星街彗星）', 'Hoshimachi Suisei'],
  ['S.O.R.e : Song of Reality', 'S.O.R.e : Song of Reality（阿芸达·栗丝）', 'Ayunda Risu'],
  ['ラプ様アーティスト化計画', 'ラプ様アーティスト化計画（拉普拉斯·暗黑）', 'La+ Darknesss'],
  ['La Mascarade', 'La Mascarade（hololive -Promise-）', 'hololive -Promise-'],
  ['Glitch Through', 'Glitch Through（诗织·诺薇拉）', 'Shiori Novella'],
  ['Grave of Halo', 'Grave of Halo（亚绮·罗森塔尔）', 'Aki Rosenthal'],
  ['64.', '64.（Anya Melfissa）', 'Anya Melfissa']
];

/** 直播常用术语：[日文, 中文, 说明性英文/备注] */
const TERMS: Array<[string, string, string?]> = [
  ['配信', '直播', 'stream'],
  ['生放送', '直播', 'live broadcast'],
  ['雑談', '杂谈回', 'chatting stream'],
  ['歌ってみた', '翻唱（投稿）', 'cover song'],
  ['ゲーム実況', '游戏实况', 'gameplay stream'],
  ['スーパーチャット', 'Super Chat（SC）', 'super chat'],
  ['スパチャ', 'SC（醒目留言）', 'super chat'],
  ['メンバーシップ', '会员（Membership）', 'membership'],
  ['箱推し', '箱推（推整个团体）', 'oshi for the whole group'],
  ['企業勢', '企业势（所属事务所）', 'corporate VTuber'],
  ['個人勢', '个人势（独立活动）', 'independent VTuber'],
  ['3Dお披露目', '3D 披露回', '3D debut'],
  ['歌枠', '歌回', 'singing stream'],
  ['切り抜き', '切片', 'clip'],
  ['凸待ち', '连麦等待（等嘉宾来电）', 'call-in waiting'],
  ['初見', '初次观看（初见）', 'first-time viewer'],
  ['同時接続', '同接（同时观看人数）', 'concurrent viewers'],
  ['待機所', '待机室（开播前等待页）', 'waiting room'],
  ['ホロメン', 'hololive 成员（箱内成员）', 'hololive member']
];

function buildEntries(): GlossaryEntry[] {
  const list: GlossaryEntry[] = [];

  TALENTS.forEach(([ja, zh, en], i) => {
    list.push({
      id: `talent-${i + 1}`,
      ja,
      zh,
      en,
      category: 'talent',
      source: ZH_WIKI,
      sourceType: 'wiki'
    });
  });

  GROUPS.forEach(([ja, zh, en], i) => {
    list.push({
      id: `group-${i + 1}`,
      ja,
      zh,
      en,
      category: 'group',
      source: ZH_WIKI,
      sourceType: 'wiki'
    });
  });

  GAMES.forEach(([ja, zh, en], i) => {
    list.push({
      id: `game-${i + 1}`,
      ja,
      zh,
      en,
      category: 'game',
      source: ZH_WIKI,
      sourceType: 'wiki'
    });
  });

  SONGS.forEach(([ja, zh, en], i) => {
    list.push({
      id: `song-${i + 1}`,
      ja,
      zh,
      en,
      category: 'song',
      source: OFFICIAL_MUSIC,
      sourceType: 'official'
    });
  });

  TERMS.forEach(([ja, zh, en], i) => {
    list.push({
      id: `term-${i + 1}`,
      ja,
      zh,
      en,
      category: 'term',
      source: JA_WIKI_VTUBER,
      sourceType: ja === '歌枠' || ja === '切り抜き' || ja === '凸待ち' || ja === '初見' || ja === '同時接続' || ja === '待機所' || ja === 'ホロメン' ? 'community' : 'wiki'
    });
  });

  return list;
}

export const GLOSSARY: GlossaryEntry[] = buildEntries();

export const GLOSSARY_CATEGORY_LABELS: Record<GlossaryCategory, string> = {
  talent: '主播',
  group: '团体',
  game: '游戏',
  song: '歌曲',
  term: '用语'
};

export interface GlossaryStats {
  total: number;
  byCategory: Record<GlossaryCategory, number>;
}

export function getGlossaryStats(): GlossaryStats {
  const byCategory: Record<GlossaryCategory, number> = { talent: 0, group: 0, game: 0, song: 0, term: 0 };
  for (const entry of GLOSSARY) byCategory[entry.category] += 1;
  return { total: GLOSSARY.length, byCategory };
}

/**
 * 在给定文本中匹配术语：多字子串命中；单字汉字需左右非汉字边界（避免「土曜日」「宝石」误命中）。
 * needsContext 标记的高频日常词按**句子**判定语境（同句还有别的术语才算游戏语境），
 * 不能按整批判定——否则「家を修繕する」会被同批其他句子的正常术语救活。
 * 返回按日文长度降序的条目，最多 limit 条，用于注入 prompt。
 */
export function findGlossaryMatches(texts: string[], limit = 40, source: GlossaryEntry[] = GLOSSARY): GlossaryEntry[] {
  if (texts.length === 0) return [];
  const haystack = texts.join('\n');
  const matched: GlossaryEntry[] = [];

  for (const entry of source) {
    const key = entry.ja.trim();
    if (!key) continue;
    if (containsTerm(haystack, key)) {
      matched.push(entry);
    }
  }

  // 逐句统计命中数，用于给 needsContext 条目判定语境
  const perTextCounts = texts.map(
    (text) => source.filter((e) => e.ja.trim() && containsTerm(text, e.ja.trim())).length
  );
  const contextualTexts = texts.filter((_, i) => perTextCounts[i] >= 2);

  const contextual = matched.filter((entry) => {
    if (!entry.needsContext) return true;
    const key = entry.ja.trim();
    // 只需在「有语境」的句子中出现过即可
    return contextualTexts.some((text) => containsTerm(text, key));
  });

  contextual.sort((a, b) => b.ja.length - a.ja.length);
  return contextual.slice(0, Math.max(0, limit));
}

/** 单个汉字是否属于汉字区（不含假名，假名是日语助词，可作合法边界） */
function isKanjiChar(ch: string): boolean {
  return /[\u3400-\u4dbf\u4e00-\u9fff]/.test(ch);
}

/**
 * 术语命中判断。
 * - 多字术语：子串命中即可（长词优先由排序保证）；
 * - 单字术语（土/石/砂/氷/弓/矢/盾/毒）：仅当左右邻接都不是汉字时才算命中，
 *   避免「土曜日」「宝石」「砂漠」这类日常词被误判成方块名。
 */
function containsTerm(haystack: string, key: string): boolean {
  if (key.length >= 2) {
    return haystack.includes(key);
  }
  let index = haystack.indexOf(key);
  while (index !== -1) {
    const prev = index > 0 ? haystack[index - 1] : '';
    const next = index + key.length < haystack.length ? haystack[index + key.length] : '';
    if (!isKanjiChar(prev) && !isKanjiChar(next)) {
      return true;
    }
    index = haystack.indexOf(key, index + 1);
  }
  return false;
}

/**
 * 生成注入 system prompt 的术语表块；无匹配时返回空串。
 */
export function buildGlossaryPromptBlock(entries: GlossaryEntry[]): string {
  if (entries.length === 0) return '';
  const lines = entries.map((e) => {
    const cat = GLOSSARY_CATEGORY_LABELS[e.category];
    return `- ${e.ja} → ${e.zh}（${cat}）`;
  });
  return `\n【术语库·必须严格采用以下译名，专有名词不得音译或加注原文】\n${lines.join('\n')}`;
}
