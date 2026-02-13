// Prompt categorization and tag extraction

const TECH_TERMS = [
  'knockout', 'knockoutjs', 'ko.observable', 'foreach', 'data-bind',
  'entity', 'dto', 'migration', 'ef core', 'dbcontext',
  'controller', 'api', 'endpoint', 'service',
  'javascript', 'js', 'css', 'html', 'cshtml', 'razor',
  'evaluation', 'project', 'assignment', 'checklist', 'dealer',
  'notification', 'signalr', 'email', 'pdf',
  'excel', 'export', 'import',
  'filter', 'search', 'sort', 'pagination',
  'docker', 'postgresql', 'sqlite', 'database',
  'localization', 'xml', 'resource',
  'git', 'commit', 'branch', 'merge',
  'test', 'build', 'deploy', 'debug'
];

const CATEGORY_PATTERNS = {
  feature_request: [
    /ekle/i, /yeni/i, /oluştur/i, /implement/i, /add/i, /create/i, /new/i,
    /yapılacak/i, /istiyorum/i, /olsun/i, /gerek/i
  ],
  bug_fix: [
    /hata/i, /bug/i, /fix/i, /düzelt/i, /çalışmıyor/i, /bozuk/i, /sorun/i,
    /error/i, /crash/i, /fail/i, /broken/i, /500/i, /404/i, /null/i
  ],
  question: [
    /\?$/, /nasıl/i, /neden/i, /ne/i, /how/i, /why/i, /what/i, /where/i,
    /anlat/i, /explain/i, /göster/i, /show/i
  ],
  refactor: [
    /refactor/i, /düzenle/i, /temizle/i, /iyileştir/i, /optimize/i,
    /clean/i, /improve/i, /rename/i, /move/i, /taşı/i
  ],
  feedback: [
    /yanlış/i, /hayır/i, /öyle değil/i, /wrong/i, /no/i, /not like/i,
    /geri al/i, /iptal/i, /beğenmedim/i, /tekrar/i
  ]
};

function categorizePrompt(content) {
  const text = content.trim();

  for (const [category, patterns] of Object.entries(CATEGORY_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        return category;
      }
    }
  }

  return 'general';
}

function extractTags(content) {
  const tags = new Set();
  const lower = content.toLowerCase();

  // Match tech terms
  for (const term of TECH_TERMS) {
    if (lower.includes(term.toLowerCase())) {
      tags.add(term);
    }
  }

  // Extract file paths/names
  const filePatterns = /[\w-]+\.(js|cs|cshtml|ts|json|xml|sql|md|css|html)/gi;
  const fileMatches = content.match(filePatterns);
  if (fileMatches) {
    fileMatches.forEach(f => tags.add(f));
  }

  // Extract entity/class names (PascalCase words)
  const pascalCase = /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g;
  const pascalMatches = content.match(pascalCase);
  if (pascalMatches) {
    pascalMatches.slice(0, 5).forEach(m => tags.add(m));
  }

  return [...tags].slice(0, 15);
}

function detectFrustration(content) {
  const frustrationPatterns = [
    /yanlış/i, /hata/i, /bozuk/i, /çalışmıyor/i,
    /tekrar/i, /yine/i, /daha önce/i, /söylemiştim/i,
    /wrong/i, /broken/i, /again/i, /already told/i,
    /!{2,}/, /\?{2,}/
  ];

  let score = 0;
  for (const pattern of frustrationPatterns) {
    if (pattern.test(content)) score++;
  }
  return Math.min(score / 3, 1); // 0-1 normalized
}

module.exports = { categorizePrompt, extractTags, detectFrustration };
