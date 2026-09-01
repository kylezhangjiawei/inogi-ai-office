import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const pages = {
  "图像生成器": source("src/app/UIDesignPage.tsx"),
  "图像作品库": source("src/app/ImageLibraryPage.tsx"),
  "视频作品库": source("src/app/VideoLibraryPage.tsx"),
  "合同 AI 审查": source("src/app/ContractReviewPage.tsx"),
};

const videoForm = source("src/app/VideoGenerateForm.tsx");
const imageStudioShared = source("src/app/imageStudioShared.tsx");
const mediaCategorySidebar = source("src/app/components/MediaCategorySidebar.tsx");
const mediaUploadDialog = source("src/app/components/MediaUploadDialog.tsx");

test("AI 创作与法务四个页面统一挂载 Horizon 根、页头和指标带", () => {
  for (const [name, page] of Object.entries(pages)) {
    assert.match(page, /horizon-theme hz-page/, `${name}应挂载 Horizon 页面根作用域`);
    assert.match(page, /<HorizonPageHeader(?:\s|>)/, `${name}应使用统一 Horizon 页头`);
    assert.match(page, /<HorizonMetricGrid(?:\s|>)/, `${name}应使用统一 KPI 指标带`);
  }
});

test("AI 创作与法务页面不包含禁用视觉、手写全屏弹层或 MUI", () => {
  const forbiddenPatterns = [
    ["渐变", /bg-gradient|linear-gradient|radial-gradient/i],
    ["紫色旧品牌类", /\b(?:purple|violet|indigo)-/i],
    ["装饰性字距", /\btracking-/],
    ["悬停位移", /hover:-translate/],
    ["手写全屏弹层", /fixed\s+inset/],
    ["MUI", /@mui(?:\/material)?|\bMui[A-Z]/],
  ];

  for (const [name, page] of Object.entries({ ...pages, "视频生成表单": videoForm })) {
    for (const [patternName, pattern] of forbiddenPatterns) {
      assert.doesNotMatch(page, pattern, `${name}不应包含${patternName}`);
    }
  }
});

test("图像生成器保留就地提示词校验、可访问表单与三条生成操作链", () => {
  const uiDesign = pages["图像生成器"];

  assert.match(uiDesign, /const \[promptError, setPromptError\] = useState\(""\)/);
  assert.match(uiDesign, /setPromptError\("请先描述想要生成的画面。"\)/);
  assert.match(uiDesign, /<label htmlFor="image-studio-prompt"/);
  assert.match(uiDesign, /aria-invalid=\{Boolean\(promptError\)\}/);
  assert.match(uiDesign, /aria-describedby=\{promptError \? "image-studio-prompt-error" : undefined\}/);
  assert.match(uiDesign, /id="image-studio-prompt-error" role="alert"/);
  assert.match(uiDesign, /aria-label="展开生成设置"/);
  assert.match(uiDesign, /aria-label="打开图像作品库"/);

  assert.match(uiDesign, /async function handleInlineOptimize\(\)/);
  assert.match(uiDesign, /async function handleGenerate\(\)/);
  assert.match(uiDesign, /async function handleEditLatest\(\)/);
  for (const apiName of ["apiList", "apiPromptChat", "apiGenerate", "apiEditImage", "apiToggleFavorite"]) {
    assert.match(uiDesign, new RegExp(`${apiName}\\(`), `图像生成器缺少 ${apiName} 调用链`);
  }
});

test("图像作品库保留双页签、搜索筛选、双视图、分页上传和分类 API", () => {
  const library = pages["图像作品库"];

  assert.match(library, /<Tabs[\s\S]{0,240}?value=\{activeTab\}/);
  assert.match(library, /<TabsContent value="作品库"/);
  assert.match(library, /<TabsContent value="用量监控"/);
  assert.match(library, /window\.setTimeout\(\(\) => setSearchKeyword\(searchInput\), searchInput \? 280 : 0\)/);
  assert.match(library, /type ViewMode = "grid" \| "list"/);
  assert.match(library, /setViewMode\("grid"\)/);
  assert.match(library, /setViewMode\("list"\)/);
  assert.match(library, /<Pager[\s\S]{0,220}?totalPages=\{totalPages\}/);
  assert.match(library, /<MediaUploadDialog/);

  for (const apiName of [
    "apiList",
    "apiListCategories",
    "apiToggleFavorite",
    "apiAssignImageCategory",
    "apiCreateCategory",
    "apiUpdateCategory",
    "apiDeleteCategory",
    "apiUploadImage",
    "apiUsage",
  ]) {
    assert.match(library, new RegExp(`${apiName}\\(`), `图像作品库缺少 ${apiName} 调用链`);
  }
});

test("图像用量区保留调用构成、模型分布、日志分页和语义表格", () => {
  const library = pages["图像作品库"];

  assert.match(library, /function LibraryUsagePanel\(/);
  assert.match(library, /调用构成/);
  assert.match(library, /模型分布/);
  assert.match(library, /调用日志/);
  assert.match(library, /<caption className="sr-only">图像生成上游调用明细<\/caption>/);
  assert.match(library, /<th scope="col"/);
  assert.match(library, /USAGE_LOG_PAGE_SIZE/);
  assert.match(library, /<Pager page=\{safeLogPage\}/);
  assert.match(library, /aria-label="切换为网格视图"/);
  assert.match(library, /aria-label="切换为列表视图"/);
  assert.match(library, /tabular-nums/);
});

test("视频工作台保留三种生成模式、预算闸门、15 秒轮询与通知定位", () => {
  const videoLibrary = pages["视频作品库"];

  assert.match(videoForm, /type Mode = "t2v" \| "i2v" \| "r2v"/);
  assert.match(videoForm, /value: "t2v", label: "文生视频"/);
  assert.match(videoForm, /value: "i2v", label: "图生视频"/);
  assert.match(videoForm, /value: "r2v", label: "参考生视频"/);
  assert.match(videoForm, /videoGenerationApi\s*\.costGate\(resolution, duration\)/);
  assert.match(videoForm, /gate\?\.blocked/);
  assert.match(videoForm, /role="alert"/);
  assert.match(videoForm, /disabled=\{!canSubmit \|\| gate\?\.blocked\}/);

  assert.match(videoLibrary, /const POLL_INTERVAL_MS = 15_000/);
  assert.match(videoLibrary, /setInterval\(\(\) => void load\(page, true\), POLL_INTERVAL_MS\)/);
  assert.match(videoLibrary, /const \[searchParams\] = useSearchParams\(\)/);
  assert.match(videoLibrary, /searchParams\.get\("video"\)/);
  assert.match(videoLibrary, /document\.getElementById\(`video-card-\$\{targetVideoId\}`\)/);
});

test("视频工作台保留上传、分类、预算设置、删除确认与生成 API", () => {
  const videoLibrary = pages["视频作品库"];

  assert.match(videoLibrary, /<MediaUploadDialog/);
  assert.match(videoLibrary, /<AlertDialog>/);
  assert.match(videoLibrary, /<AlertDialogContent className="horizon-portal">/);
  assert.match(videoLibrary, /确认永久删除该视频/);
  for (const apiName of [
    "listVideos",
    "listCategories",
    "createCategory",
    "updateCategory",
    "deleteCategory",
    "assignCategory",
    "deleteVideo",
    "uploadVideo",
    "getCostGateConfig",
    "saveCostGateConfig",
  ]) {
    assert.match(videoLibrary, new RegExp(`videoGenerationApi\\.${apiName}\\(`), `视频作品库缺少 ${apiName} 调用链`);
  }
  for (const apiName of ["costGate", "reversePrompt", "submit"]) {
    assert.match(videoForm, new RegExp(`videoGenerationApi(?:\\s*)\\.${apiName}\\(`), `视频生成表单缺少 ${apiName} 调用链`);
  }
  assert.match(videoForm, /uploadResourceFile\(file, "uploads-temp"\)/);
});

test("合同审查诚实加载示例并保留键盘条款、风险筛选、谈判和摘要流程", () => {
  const contract = pages["合同 AI 审查"];

  assert.match(contract, /const \[sampleLoaded, setSampleLoaded\] = useState\(false\)/);
  assert.match(contract, /const loadSampleContract = \(\) =>/);
  assert.match(contract, /已加载示例合同，可开始演示条款与风险审查/);
  assert.match(contract, /当前未连接真实文件上传或 AI 审查服务/);
  assert.doesNotMatch(contract, /type="file"/);

  assert.match(contract, /function ClauseAccordion\(/);
  assert.match(contract, /<button[\s\S]{0,100}?type="button"[\s\S]{0,180}?aria-expanded=/);
  assert.match(contract, /aria-controls=\{`contract-clause-\$\{clause\.id\}`\}/);
  assert.match(contract, /const \[riskFilter, setRiskFilter\]/);
  assert.match(contract, /role="group" aria-labelledby="contract-risk-filter-label"/);
  assert.match(contract, /const \[stance, setStance\]/);
  assert.match(contract, /role="group" aria-labelledby="contract-stance-label"/);
  assert.match(contract, /const adoptSuggestion = \(id: string\) =>/);
  assert.match(contract, /onClick=\{\(\) => adoptSuggestion\(risk\.id\)\}/);
  assert.match(contract, /title="执行摘要"/);
  assert.match(contract, /id="contract-executive-summary"/);
  assert.match(contract, /核心风险 TOP 3/);
});

test("共享媒体弹窗统一使用 Dialog 或 AlertDialog 与 Horizon portal", () => {
  assert.match(imageStudioShared, /ui\/dialog/);
  assert.match(imageStudioShared, /<Dialog open/);
  assert.match(imageStudioShared, /<DialogContent[\s\S]{0,220}?horizon-portal/);

  assert.match(mediaCategorySidebar, /ui\/dialog/);
  assert.match(mediaCategorySidebar, /ui\/alert-dialog/);
  assert.equal((mediaCategorySidebar.match(/<DialogContent\b/g) ?? []).length, 1);
  assert.match(mediaCategorySidebar, /"horizon-portal flex max-h-/);
  assert.match(mediaCategorySidebar, /<AlertDialogContent[\s\S]{0,260}?horizon-portal/);

  assert.match(mediaUploadDialog, /import \{ ModalShell \} from "\.\/MediaCategorySidebar"/);
  assert.match(mediaUploadDialog, /<ModalShell/);
  assert.match(mediaUploadDialog, /dismissible=\{!uploading\}/);
});

test("共享媒体弹窗不再包含手写遮罩、浏览器确认、禁用色或 MUI", () => {
  const forbiddenPatterns = [
    ["紫色旧品牌类", /\b(?:purple|violet|indigo)-/i],
    ["手写全屏弹层", /fixed\s+inset/],
    ["浏览器确认框", /window\.confirm/],
    ["MUI", /@mui(?:\/material)?|\bMui[A-Z]/],
  ];

  for (const [name, sharedSource] of Object.entries({
    imageStudioShared,
    MediaCategorySidebar: mediaCategorySidebar,
    MediaUploadDialog: mediaUploadDialog,
  })) {
    for (const [patternName, pattern] of forbiddenPatterns) {
      assert.doesNotMatch(sharedSource, pattern, `${name}不应包含${patternName}`);
    }
  }
});
