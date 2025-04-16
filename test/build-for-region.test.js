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

async function testDict(country, defaultLang, dict) {
   const regionOutputFolder = country ? `${outputFolder}_${country}` : outputFolder;

   const contents = await fs.readJSON(path.join(regionOutputFolder, 'RegionModule/contents.json'));

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
      ...toCompressedFile(filePath.replace(/\.json$/, '.min.json')),
      ...toCompressedFile(`${filePath}.min.js`)
   ];
}

describe('regional workflow', () => {
   const fixtureFolder = path.join(dirname, 'fixture/build-for-region');

   before(async() => {
      await initTest();
   });

   describe('ru', () => {
      const defaultLang = 'ru';

      before(async() => {
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
            'en-KZ',
            'en-TM',
            'es',
            'fr',
            'he',
            'kk',
            'kk-KZ',
            'ru',
            'ru-KZ',
            'ru-TM',
            'tk',
            'uz',
            'zh'
         ];

         await testDict('', defaultLang, expectedDict);
      });

      it('should have correct files in module', async() => {
         const expectedFiles = [
            'ar',
            'el',
            'en',
            'en-KZ',
            'en-TM',
            'es',
            'fr',
            'he',
            'kk',
            'kk-KZ',
            'ru',
            'ru-KZ',
            'ru-TM',
            'tk',
            'uz',
            'zh'
         ].map(name => `${name}.json`);

         await testLangFiles('', expectedFiles);
      });

      it('should have correct translations', async() => {
         await testDictKey('', 'en', 'ключ', 'значение для en');
         await testDictKey('', 'kk', 'ключ', 'значение для kk');
         await testDictKey('', 'ru', 'ключ', 'значение для ru');
      });

      it('should have compressed files in module', async() => {
         const files = [
            ...toCompressedMinifiedJson('RegionModule/lang/ru/ru.json'),
            ...toCompressedMinifiedJson('RegionModule/lang/ru/ru-KZ.json'),
            ...toCompressedMinifiedJson('RegionModule/lang/ru/ru-TM.json'),
         ];

         await testFilesExist('', files);
      });
   });
});
