#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_PATH = path.resolve(__dirname, '../web/public/data/celebrities.json');
const CACHE_PATH = path.resolve(__dirname, 'meta_wikidata.json');
const USER_AGENT = 'face-ranking-and-lookalike/1.0 (metadata refresh)';
const ENTITY_BATCH_SIZE = 50;
const RETRY_DELAY_MS = 1500;
const TITLE_ALIASES = {
  '\u7530\u4e2d\u77b3': ['\u7530\u4e2d\u77b3 (\u30a2\u30ca\u30a6\u30f3\u30b5\u30fc)'],
  '安村': ['とにかく明るい安村'],
  '見取り図盛山': ['盛山晋太郎'],
  'ウエストランド井口': ['井口浩之'],
  'マヂカルラブリー村上': ['村上 (お笑い芸人)'],
  'バイきんぐ小峠': ['小峠英二'],
  '宮川大輔': ['宮川大輔 (タレント)', '宮川大輔'],
  '渡辺雄太': ['渡邊雄太'],
  '長谷川唯': ['長谷川唯 (サッカー選手)'],
  '三四郎小宮': ['小宮浩信'],
  'NON STYLE井上': ['井上裕介 (お笑い芸人)'],
  '錦鯉渡辺': ['渡辺隆 (お笑い芸人)'],
  '橋本大輝': ['橋本大輝 (体操選手)', '橋本大輝'],
};
const MANUAL_METADATA_OVERRIDES = {
  '橋本大輝': {
    age: 24,
    birthDate: '2001-08-07',
    wikipediaTitle: '橋本大輝 (体操選手)',
    gender: 'male',
  },
  '安村': {
    age: 44,
    birthDate: '1982-03-15',
    wikipediaTitle: 'とにかく明るい安村',
    gender: 'male',
  },
  '見取り図盛山': {
    age: 40,
    birthDate: '1986-01-09',
    wikipediaTitle: '盛山晋太郎',
    gender: 'male',
  },
  'ウエストランド井口': {
    age: 42,
    birthDate: '1983-05-06',
    wikipediaTitle: '井口浩之',
    gender: 'male',
  },
  'マヂカルラブリー村上': {
    age: 41,
    birthDate: '1984-10-15',
    wikipediaTitle: '村上 (お笑い芸人)',
    gender: 'male',
  },
  'バイきんぐ小峠': {
    age: 49,
    birthDate: '1976-06-06',
    wikipediaTitle: '小峠英二',
    gender: 'male',
  },
  '宮川大輔': {
    age: 53,
    birthDate: '1972-09-16',
    wikipediaTitle: '宮川大輔',
    gender: 'male',
  },
  '渡辺雄太': {
    age: 31,
    birthDate: '1994-10-13',
    wikipediaTitle: '渡邊雄太',
    gender: 'male',
  },
  '長谷川唯': {
    age: 29,
    birthDate: '1997-01-29',
    wikipediaTitle: '長谷川唯 (サッカー選手)',
    gender: 'female',
  },
  '三四郎小宮': {
    age: 42,
    birthDate: '1983-09-03',
    wikipediaTitle: '小宮浩信',
    gender: 'male',
  },
  'NON STYLE井上': {
    age: 46,
    birthDate: '1980-03-01',
    wikipediaTitle: '井上裕介 (お笑い芸人)',
    gender: 'male',
  },
  '錦鯉渡辺': {
    age: 47,
    birthDate: '1978-04-15',
    wikipediaTitle: '渡辺隆 (お笑い芸人)',
    gender: 'male',
  },
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ageFromBirthDate(birthDate, today = new Date()) {
  const [year, month, day] = birthDate.split('-').map(Number);
  let age = today.getUTCFullYear() - year;
  const currentMonth = today.getUTCMonth() + 1;
  const currentDay = today.getUTCDate();
  if (currentMonth < month || (currentMonth === month && currentDay < day)) {
    age -= 1;
  }
  return age;
}

async function fetchJson(url, params, attempt = 1) {
  const fullUrl = `${url}?${new URLSearchParams(params).toString()}`;
  const response = await fetch(fullUrl, {
    headers: {
      'user-agent': USER_AGENT,
    },
  });

  if (response.status === 429 && attempt < 8) {
    await sleep(RETRY_DELAY_MS * attempt);
    return fetchJson(url, params, attempt + 1);
  }

  if (!response.ok) {
    throw new Error(`${response.status} ${fullUrl}`);
  }

  return response.json();
}

function candidateTitles(name) {
  const values = new Set(TITLE_ALIASES[name] || []);
  values.add(name);
  values.add(name.replace(/[（(].*?[）)]/g, '').trim());
  values.add(name.replace(/\s+/g, ' ').trim());
  values.add(name.replace(/\s+/g, '').trim());
  return [...values].filter(Boolean);
}

async function resolveExactQid(title) {
  let data;
  try {
    data = await fetchJson('https://ja.wikipedia.org/w/api.php', {
      action: 'query',
      titles: title,
      redirects: '1',
      prop: 'pageprops',
      ppprop: 'wikibase_item',
      format: 'json',
    });
  } catch (error) {
    return null;
  }

  for (const page of Object.values(data.query?.pages || {})) {
    const qid = page.pageprops?.wikibase_item;
    if (qid) {
      return {
        qid,
        wikipediaTitle: page.title,
      };
    }
  }

  return null;
}

async function resolveSearchQid(query) {
  let search;
  try {
    search = await fetchJson('https://ja.wikipedia.org/w/api.php', {
      action: 'query',
      list: 'search',
      srsearch: query,
      srlimit: '5',
      format: 'json',
    });
  } catch (error) {
    return null;
  }

  for (const hit of search.query?.search || []) {
    const resolved = await resolveExactQid(hit.title);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

async function resolveName(name, cached) {
  if (cached?.wikidataId && cached?.wikipediaTitle) {
    return {
      qid: cached.wikidataId,
      wikipediaTitle: cached.wikipediaTitle,
    };
  }

  for (const title of candidateTitles(name)) {
    const resolved = await resolveExactQid(title);
    if (resolved) {
      return resolved;
    }
  }

  for (const title of candidateTitles(name)) {
    const resolved = await resolveSearchQid(title);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

function extractBirthDate(entity) {
  const time = entity?.claims?.P569?.[0]?.mainsnak?.datavalue?.value?.time;
  if (!time || typeof time !== 'string' || time.length < 11) {
    return null;
  }

  const [year, month, day] = time.slice(1, 11).split('-').map(Number);
  if (!year || !month || !day) {
    return null;
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function extractGender(entity) {
  const id = entity?.claims?.P21?.[0]?.mainsnak?.datavalue?.value?.id;
  if (id === 'Q6581097') return 'male';
  if (id === 'Q6581072') return 'female';
  return undefined;
}

async function fetchEntities(qids) {
  const result = new Map();

  for (let i = 0; i < qids.length; i += ENTITY_BATCH_SIZE) {
    const batch = qids.slice(i, i + ENTITY_BATCH_SIZE);
    const data = await fetchJson('https://www.wikidata.org/w/api.php', {
      action: 'wbgetentities',
      ids: batch.join('|'),
      props: 'claims',
      format: 'json',
    });

    for (const qid of batch) {
      const entity = data.entities?.[qid];
      if (entity) {
        result.set(qid, entity);
      }
    }

    console.log(`Fetched Wikidata claims: ${Math.min(i + batch.length, qids.length)}/${qids.length}`);
    await sleep(250);
  }

  return result;
}

function sortObjectByKey(value) {
  return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'ja'))
  );
}

async function main() {
  const celebrities = JSON.parse(await fs.readFile(DATA_PATH, 'utf8'));
  const cliNames = new Set();

  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg === '--names' && process.argv[i + 1]) {
      process.argv[i + 1]
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .forEach((value) => cliNames.add(value));
      i += 1;
      continue;
    }

    if (arg === '--names-file' && process.argv[i + 1]) {
      const namesPath = path.resolve(process.cwd(), process.argv[i + 1]);
      const content = await fs.readFile(namesPath, 'utf8');
      content
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean)
        .forEach((value) => cliNames.add(value));
      i += 1;
    }
  }

  let cache = {};
  try {
    cache = JSON.parse(await fs.readFile(CACHE_PATH, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  cache = {
    ...cache,
    ...MANUAL_METADATA_OVERRIDES,
  };

  const targets =
    cliNames.size > 0
      ? [...cliNames]
          .filter(
            (name) =>
              cache[name]?.age == null &&
              cache[name]?.birthDate == null
          )
          .map((name) => ({ name }))
      : celebrities.filter(
          (celebrity) =>
            celebrity.age == null &&
            cache[celebrity.name]?.age == null &&
            cache[celebrity.name]?.birthDate == null
        );

  if (targets.length === 0) {
    console.log('No metadata targets found.');
    return;
  }

  const resolved = new Map();
  const unresolved = [];

  for (let i = 0; i < targets.length; i += 1) {
    const celebrity = targets[i];
    const cached = cache[celebrity.name];
    const match = await resolveName(celebrity.name, cached);
    if (match) {
      resolved.set(celebrity.name, match);
    } else {
      unresolved.push(celebrity.name);
    }

    if ((i + 1) % 25 === 0 || i + 1 === targets.length) {
      console.log(`Resolved Wikipedia titles: ${i + 1}/${targets.length}`);
    }

    await sleep(100);
  }

  const qids = [...new Set([...resolved.values()].map((value) => value.qid))];
  const entities = await fetchEntities(qids);

  let updated = 0;
  let skipped = 0;

  for (const celebrity of targets) {
    const match = resolved.get(celebrity.name);
    if (!match) {
      skipped += 1;
      continue;
    }

    const entity = entities.get(match.qid);
    const birthDate = extractBirthDate(entity);
    if (!birthDate) {
      skipped += 1;
      continue;
    }

    const next = {
      ...(cache[celebrity.name] || {}),
      age: ageFromBirthDate(birthDate),
      birthDate,
      wikidataId: match.qid,
      wikipediaTitle: match.wikipediaTitle,
    };

    const gender = extractGender(entity);
    if (gender) {
      next.gender = gender;
    }

    cache[celebrity.name] = next;
    updated += 1;
  }

  await fs.writeFile(CACHE_PATH, `${JSON.stringify(sortObjectByKey(cache), null, 2)}\n`, 'utf8');

  console.log(`Updated cache entries: ${updated}`);
  console.log(`Still missing metadata: ${skipped}`);
  if (unresolved.length > 0) {
    console.log('Unresolved names (first 30):');
    for (const name of unresolved.slice(0, 30)) {
      console.log(`  - ${name}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
