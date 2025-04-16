'use strict';

const initTest = require('./init-test');

const { expect } = require('chai');

const { path, toPosix } = require('../lib/platform/path');
const fs = require('fs-extra'),
   { promiseWithTimeout, TimeoutError } = require('../lib/promise-with-timeout');

const generateWorkflow = require('../gulp/builder/generate-workflow.js');

const { TIMEOUT_FOR_HEAVY_TASKS } = require('./lib');

const dirname = toPosix(__dirname);
const workspaceFolder = path.join(dirname, 'workspace'),
   cacheFolder = path.join(workspaceFolder, 'cache'),
   outputFolder = path.join(workspaceFolder, 'output'),
   logsFolder = path.join(workspaceFolder, 'logs'),
   sourceFolder = path.join(workspaceFolder, 'source'),
   configPath = path.join(workspaceFolder, 'config.json');

const runWorkflow = function() {
   return new Promise((resolve, reject) => {
      generateWorkflow([`--config="${configPath}"`])((error) => {
         if (error) {
            reject(error);
         } else {
            resolve();
         }
      });
   });
};

const runWorkflowWithTimeout = async function(timeout) {
   let result;
   try {
      result = await promiseWithTimeout(runWorkflow(), timeout || TIMEOUT_FOR_HEAVY_TASKS);
   } catch (err) {
      result = err;
   }
   if (result instanceof TimeoutError) {
      true.should.equal(false);
   }
};

const clearWorkspace = function() {
   return fs.remove(workspaceFolder);
};

const prepareTest = async function(fixtureFolder) {
   await clearWorkspace();
   await fs.ensureDir(sourceFolder);
   await fs.copy(fixtureFolder, sourceFolder);
};

const getConfig = defaultLang => ({
   cache: cacheFolder,
   output: outputFolder,
   logs: logsFolder,
   localization: [
      'ar',
      'el',
      'en',
      'es',
      'fr',
      'he',
      'kk',
      'ru',
      'tk',
      'uz',
      'zh'
   ],
   'default-localization': defaultLang,
   countries: [
      'KZ',
      'RU',
      'TM',
      'UZ'
   ],
   minimize: true,
   deprecatedOwnDependencies: true,
   customPack: true,
   compress: true,
   sources: true,
   presentationServiceMeta: true,
   dependenciesGraph: true,
   contents: true,
   cdnUrl: '/cdn/',
   'multi-service': true,
   'url-service-path': '/service/',
   modules: [{
      name: 'RegionModule',
      path: path.join(sourceFolder, 'RegionModule')
   }]
});

async function testDict(defaultLang, dict) {
   const contents = await fs.readJSON(path.join(outputFolder, 'RegionModule/contents.json'));

   expect(contents.defaultLanguage).to.equal(defaultLang);
   expect(contents.modules.RegionModule.dict.sort()).to.deep.equal(dict.sort());
}

async function readFileNames(dirPath, pattern) {
   const list = await fs.readdir(dirPath, { withFileTypes: true });

   const result = [];

   for await (const entry of list) {
      if (entry.isDirectory()) {
         result.push(...await readFileNames(path.join(dirPath, entry.name), pattern));

         continue;
      }

      if (pattern.test(entry.name)) {
         result.push(entry.name);
      }
   }

   return result;
}

async function testLangFiles(country, expectedNames) {
   const regionOutputFolder = country ? `${outputFolder}_${country}` : outputFolder;

   const files = await readFileNames(path.join(regionOutputFolder, 'RegionModule/lang'), /^(\w{2}(-\w{2})?)\.json$/i);

   expect(files.sort()).to.deep.equal(expectedNames.sort());
}

async function testDictKey(country, lang, key, translation) {
   const regionOutputFolder = country ? `${outputFolder}_${country}` : outputFolder;

   const dict = await fs.readJSON(path.join(regionOutputFolder, `RegionModule/lang/${lang}/${lang}.json`));

   expect(dict[key]).to.equal(translation);
}

function evalModule(sourceText) {
   let result;

   // eslint-disable-next-line no-unused-vars
   const define = (mod, dep, cb) => {
      if (typeof cb === 'function') {
         result = cb();

         return;
      }

      if (typeof dep === 'function') {
         result = dep();

         return;
      }

      if (typeof mod === 'function') {
         result = mod();
      }
   };

   // eslint-disable-next-line no-eval
   eval(sourceText);

   return result;
}

async function testDictKeyInModule(country, lang, key, translation) {
   const regionOutputFolder = country ? `${outputFolder}_${country}` : outputFolder;

   const sourceText = await fs.readFile(
      path.join(regionOutputFolder, `RegionModule/lang/${lang}/${lang}.json.min.js`),
      'utf-8'
   );

   const dict = evalModule(sourceText);

   expect(dict[key]).to.equal(translation);
}

async function testFilesExist(country, files) {
   const regionOutputFolder = country ? `${outputFolder}_${country}` : outputFolder;

   for await (const filePath of files) {
      if (await fs.pathExists(path.join(regionOutputFolder, filePath))) {
         continue;
      }

      throw new Error(`File ${filePath} does not exist`);
   }
}

function toCompressedMinifiedJson(filePath) {
   const toCompressedFile = f => [`${f}.br`, `${f}.gz`];

   return [
      ...toCompressedFile(`${filePath}.min.js`)
   ];
}

describe.skip('regional workflow', () => {
   const defaultLang = 'ru';

   before(async() => {
      const fixtureFolder = path.join(dirname, 'fixture/build-for-region');

      await initTest();

      await prepareTest(fixtureFolder);

      await fs.writeJSON(configPath, getConfig(defaultLang));

      await runWorkflowWithTimeout();
   });

   after(async() => {
      await clearWorkspace();
   });

   it('should have correct dict in contents', async() => {
      const expectedDict = [
         'ar',
         'el',
         'en',
         'es',
         'fr',
         'he',
         'kk',
         'ru',
         'tk',
         'uz',
         'zh'
      ];

      await testDict(defaultLang, expectedDict);
   });

   describe('RU', () => {
      const country = '';

      it('should have correct files in module', async() => {
         const expectedFiles = [
            'ar',
            'el',
            'en',
            'es',
            'fr',
            'he',
            'kk',
            'ru',
            'tk',
            'uz',
            'zh'
         ].map(name => `${name}.json`);

         await testLangFiles(country, expectedFiles);
      });

      it('should have correct translations', async() => {
         for await (const lang of ['en', 'kk']) {
            await testDictKey(country, lang, 'общий-ключ', `общее значение для ${lang}`);
            await testDictKey(country, lang, 'ключ', `значение для ${lang}`);
         }
      });

      it('should have correct translations for RU', async() => {
         for await (const lang of ['ru']) {
            await testDictKey(country, lang, 'общий-ключ', `общее значение для ${lang}`);
            await testDictKey(country, lang, 'ключ', `значение для ${lang} в RU`);
         }
      });

      it('should have compressed files in module', async() => {
         const files = [
            ...toCompressedMinifiedJson('RegionModule/lang/ru/ru.json')
         ];

         await testFilesExist(country, files);
      });

      it('should have correct minified content', async() => {
         for await (const lang of ['en', 'kk']) {
            await testDictKeyInModule(country, lang, 'общий-ключ', `общее значение для ${lang}`);
            await testDictKeyInModule(country, lang, 'ключ', `значение для ${lang}`);
         }
      });

      it('should have correct minified content for RU', async() => {
         for await (const lang of ['ru']) {
            await testDictKeyInModule(country, lang, 'общий-ключ', `общее значение для ${lang}`);
            await testDictKeyInModule(country, lang, 'ключ', `значение для ${lang} в RU`);
         }
      });
   });

   describe('KZ', () => {
      const country = 'KZ';

      it('should have correct files in module', async() => {
         const expectedFiles = [
            'en',
            'kk',
            'ru'
         ].map(name => `${name}.json`);

         await testLangFiles(country, expectedFiles);
      });

      it('should have correct translations', async() => {
         for await (const lang of ['en', 'kk', 'ru']) {
            await testDictKey(country, lang, 'общий-ключ', `общее значение для ${lang}`);
            await testDictKey(country, lang, 'ключ', `значение для ${lang} в ${country}`);
         }
      });

      it('should have compressed files in module', async() => {
         const files = [
            ...toCompressedMinifiedJson('RegionModule/lang/ru/ru.json')
         ];

         await testFilesExist(country, files);
      });

      it('should have correct minified content', async() => {
         for await (const lang of ['en', 'kk', 'ru']) {
            await testDictKeyInModule(country, lang, 'общий-ключ', `общее значение для ${lang}`);
            await testDictKeyInModule(country, lang, 'ключ', `значение для ${lang} в ${country}`);
         }
      });
   });
});
