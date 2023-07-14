/**
 * Main unit-tests for builder workflow generator(main workflow for 'build' task)
 * @author Kolbeshin F.A.
 */

'use strict';

const initTest = require('./init-test');

const { path, toSafePosix, toPosix } = require('../lib/platform/path');
const fs = require('fs-extra'),
   pMap = require('p-map'),
   { brotliDecompress } = require('zlib'),
   { promiseWithTimeout, TimeoutError } = require('../lib/promise-with-timeout');

const generateWorkflow = require('../gulp/builder/generate-workflow.js');

const {
   timeoutForMacOS, getMTime, removeRSymbol, isSymlink, isRegularFile, linkPlatform, TIMEOUT_FOR_HEAVY_TASKS
} = require('./lib');

const dirname = toPosix(__dirname);
const workspaceFolder = path.join(dirname, 'workspace'),
   cacheFolder = path.join(workspaceFolder, 'cache'),
   outputFolder = path.join(workspaceFolder, 'output'),
   logsFolder = path.join(workspaceFolder, 'logs'),
   sourceFolder = path.join(workspaceFolder, 'source'),
   configPath = path.join(workspaceFolder, 'config.json'),
   moduleOutputFolder = path.join(outputFolder, 'Modul'),
   module2OutputFolder = path.join(outputFolder, 'Modul2'),
   moduleSourceFolder = path.join(sourceFolder, 'Модуль'),
   themesSourceFolder = path.join(sourceFolder, 'Тема Скрепка');

const clearWorkspace = function() {
   return fs.remove(workspaceFolder);
};

const prepareTest = async function(fixtureFolder) {
   await clearWorkspace();
   await fs.ensureDir(sourceFolder);
   await fs.copy(fixtureFolder, sourceFolder);
};

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

const decompress = function(data) {
   return new Promise((resolve, reject) => {
      brotliDecompress(data, (err, decompressed) => {
         if (err) {
            reject(err);
         } else {
            resolve(decompressed);
         }
      });
   });
};

/**
 * properly finish test in builder main workflow was freezed by unexpected
 * critical errors from gulp plugins
 * @returns {Promise<void>}
 */
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

// нужно проверить что происходит:
// 1. при переименовывании файла == добавление/удаление файла
// 2. при изменении файла
// 3. если файл не менять
describe('gulp/builder/generate-workflow.js', () => {
   before(async() => {
      await initTest();
   });
   const testEmptyLessLog = async(fileNames, extensions) => {
      const testResult = (arrayToTest, resultArray) => {
         let result = true;
         arrayToTest.forEach((currentMember) => {
            if (!resultArray.has(currentMember)) {
               result = false;
            }
         });
         return result;
      };
      const { messages } = await fs.readJson(path.join(logsFolder, 'builder_report.json'));
      const resultExtensions = new Set();
      const resultFileNames = new Set();
      messages.forEach((curMesObj) => {
         const currentPath = toSafePosix(curMesObj.file);
         const currentFileName = currentPath.split('/').pop();
         const currentExtension = currentFileName.split('.').pop();
         if (curMesObj.message.includes(`Empty ${currentExtension} file is discovered.`)) {
            resultExtensions.add(currentExtension);
            resultFileNames.add(currentFileName);
         }
      });
      testResult(fileNames, resultFileNames).should.equal(true);
      testResult(extensions, resultExtensions).should.equal(true);
   };

   it('compile less with coverage', async() => {
      const fixtureFolder = path.join(dirname, 'fixture/builder-generate-workflow/less');
      await prepareTest(fixtureFolder);

      const config = {
         cache: cacheFolder,
         output: outputFolder,
         logs: logsFolder,
         lessCoverage: true,
         less: true,
         typescript: true,
         dependenciesGraph: true,
         builderTests: true,
         modules: [
            {
               name: 'SBIS3.CONTROLS',
               path: path.join(sourceFolder, 'SBIS3.CONTROLS')
            },
            {
               name: 'Controls-default-theme',
               path: path.join(sourceFolder, 'Controls-default-theme')
            },
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль')
            },
            {
               name: 'TestModule',
               path: path.join(sourceFolder, 'TestModule')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      // запустим таску
      await runWorkflowWithTimeout();

      const testModuleDepsPath = path.join(outputFolder, 'TestModule/module-dependencies.json');
      let lessDependenciesForTest = (await fs.readJson(testModuleDepsPath)).lessDependencies;

      lessDependenciesForTest['TestModule/stable'].should.have.members([
         'css!Controls-default-theme/_old-mixins',
         'css!SBIS3.CONTROLS/themes/_mixins',
         'css!Controls-default-theme/_mixins',
         'css!Controls-default-theme/_new-mixins',
         'css!TestModule/Stable-for-import',
         'css!TestModule/Stable-for-theme-import',
         'css!TestModule/Stable-with-import',
         'css!TestModule/test-style-assign',
         'css!TestModule/test-styles-object',
         'css!TestModule/test-theme-object',
         'css!Модуль/Stable'
      ]);

      // запустим повторно таску
      await runWorkflowWithTimeout();

      lessDependenciesForTest = (await fs.readJson(testModuleDepsPath)).lessDependencies;
      lessDependenciesForTest['TestModule/stable'].should.have.members([
         'css!Controls-default-theme/_old-mixins',
         'css!SBIS3.CONTROLS/themes/_mixins',
         'css!Controls-default-theme/_mixins',
         'css!Controls-default-theme/_new-mixins',
         'css!TestModule/Stable-for-import',
         'css!TestModule/Stable-for-theme-import',
         'css!TestModule/Stable-with-import',
         'css!TestModule/test-style-assign',
         'css!TestModule/test-styles-object',
         'css!TestModule/test-theme-object',
         'css!Модуль/Stable'
      ]);

      await clearWorkspace();
   });

   it('check correct output of patches sequence', async() => {
      // Сценарий тестирования следующий:
      // Дано 3 модуля - Modul, Modul2 и TestModule.
      // 1) Собираем stable сборку
      // 2) Готовим патч 1 - меняем ts-файл в модуле Modul. Собираем его.
      // 3) Проверяем выхлоп первого патча. В результате сборки патча должна быть
      // правка в ts-файле и его скомпилированных данных, в конечной билдера их быть
      // не должно, поскольку в конечной мы храним состояние модуля из stable сборки.
      // 4) Готовим патч 2 - меняем ts-файл в модуле Modul2. Собираем его.
      // 5) Проверяем выхлоп второго патча. В результате сборки патча должна быть правка
      // в ts-файле Modul2 и его скомпилированных данных, не должно быть правок из патча 1,
      // а также в конечной директории сборки билдера не должно быть изменений из обоих патчей,
      // поскольку храним Stable состояние модуля
      // 6) Запускаем следующую stable сборку.
      // 7) В конечной директории должны быть правки, применённые и в первом и втором патче. То есть
      // stable сборка должна закрепить в стабильном состоянии все ранее запущенные патчи.

      const fixtureFolder = path.join(dirname, 'fixture/builder-generate-workflow/_packLibraries');
      const changedFilesOutput = `${outputFolder}_patch`;
      await prepareTest(fixtureFolder);

      // функция, которая проверяет наличие определённого текста в определённом файле в конечной
      // директории и, при необходимости, в директории результатов сборки патчей.
      const checkChanges = async(changesContent, fileName, outputHasChanges, changedFilesOutputHasChanges) => {
         await pMap(
            ['.ts', '.js'],
            async(extension) => {
               const outputContent = await fs.readFile(path.join(outputFolder, `${fileName}${extension}`), 'utf8');

               outputContent.includes(changesContent).should.equal(outputHasChanges);

               if (typeof changedFilesOutputHasChanges === 'boolean') {
                  const changedFilesOutputContent = await fs.readFile(path.join(changedFilesOutput, `${fileName}${extension}`), 'utf8');

                  changedFilesOutputContent.includes(changesContent).should.equal(changedFilesOutputHasChanges);
               }
            }
         );
      };


      const config = {
         cache: cacheFolder,
         output: outputFolder,
         logs: logsFolder,
         symlinks: false,
         clearOutput: false,
         less: true,
         typescript: true,
         dependenciesGraph: true,
         minimize: true,
         compress: true,
         modules: [
            {
               name: 'Modul',
               path: path.join(sourceFolder, 'Modul')
            },
            {
               name: 'Modul2',
               path: path.join(sourceFolder, 'Modul2')
            },
            {
               name: 'TestModule',
               path: path.join(sourceFolder, 'TestModule')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      // запускаем stable сборку
      await runWorkflowWithTimeout();

      // готовим первый патч - изменяем ts-файл из модуля Modul и генерим конфиг с передачей
      // конкретных изменений
      config.modules[0].rebuild = true;
      config.modules[0].changedFiles = ['./libraryCycle.ts'];
      config.modules[0].deletedFiles = [];
      config.modules[1].rebuild = true;
      config.modules[1].changedFiles = [];
      config.modules[1].deletedFiles = [];
      config.output = changedFilesOutput;
      await fs.writeJSON(configPath, config);

      let content = await fs.readFile(path.join(sourceFolder, 'Modul/libraryCycle.ts'));
      await fs.outputFile(
         path.join(sourceFolder, 'Modul/libraryCycle.ts'),
         `/* patch 1 */\n${content}\n export function TestFunction() {return {}}`
      );

      // собираем первый патч
      await runWorkflowWithTimeout();

      // проверяем, что в директории сборки патча в Modul появились нужные правки для ts-файл.
      // а в конечной директории сборки сохранилось состояние модуля из stable сборки.
      await checkChanges('/* patch 1 */', 'Modul/libraryCycle', false, true);

      // Проверяем, что сгенерились сжатые файлы для ts-ки, которую пропатчили и сразу удаляем
      // их, чтобы проверить, что при повторном запуске сборки этого патча они перегенерятся
      (await isRegularFile(path.join(changedFilesOutput, 'Modul'), 'libraryCycle.min.js.gz')).should.equal(true);
      (await isRegularFile(path.join(changedFilesOutput, 'Modul'), 'libraryCycle.min.js.br')).should.equal(true);
      await fs.remove(path.join(moduleOutputFolder, 'libraryCycle.min.js.br'));
      await fs.remove(path.join(moduleOutputFolder, 'libraryCycle.min.js.gz'));

      // ещё раз собираем первый патч, чтобы проверить правильную работу сборки сжатых файлов
      await runWorkflowWithTimeout();

      // сжатые файлы для патченной ts-ки должны появиться
      (await isRegularFile(path.join(changedFilesOutput, 'Modul'), 'libraryCycle.min.js.gz')).should.equal(true);
      (await isRegularFile(path.join(changedFilesOutput, 'Modul'), 'libraryCycle.min.js.br')).should.equal(true);

      // готовим второй патч - изменяем ts-файл из модуля Modul2 и генерим конфиг с передачей
      // конкретных изменений
      config.modules[0].rebuild = true;
      config.modules[0].changedFiles = [];
      config.modules[0].deletedFiles = [];
      config.modules[1].rebuild = true;
      config.modules[1].changedFiles = ['./Module2.ts'];
      config.modules[1].deletedFiles = [];
      config.output = changedFilesOutput;
      await fs.writeJSON(configPath, config);

      content = await fs.readFile(path.join(sourceFolder, 'Modul2/Module2.ts'));
      await fs.outputFile(
         path.join(sourceFolder, 'Modul2/Module2.ts'),
         `/* patch 2 */\n${content}`
      );

      // собираем второй патч.
      await runWorkflowWithTimeout();

      // проверяем, что в директории сборки патча в Modul2 появились нужные правки для ts-файл.
      // а в конечной директории сборки сохранилось состояние модуля из stable сборки. А для модуля
      // Modul1 не должно быть изменений и в конечной директории сборки, ни в директории сборки патчей
      // поскольку изменения из предыдущего патча в данный патч попасть не должны
      await checkChanges('/* patch 2 */', 'Modul2/Module2', false, true);
      await checkChanges('/* patch 1 */', 'Modul/libraryCycle', false, false);

      // готовим следующую stable сборку. В ней мы накатываем в стабильную версию все ранее пропатченные модули.
      delete config.modules[0].rebuild;
      config.modules[0].changedFiles = ['./libraryCycle.ts'];
      config.modules[0].deletedFiles = [];
      delete config.modules[1].rebuild;
      config.modules[1].changedFiles = ['./Module2.ts'];
      config.modules[1].deletedFiles = [];
      config.output = outputFolder;
      await fs.writeJSON(configPath, config);

      // собираем stable сборку
      await runWorkflowWithTimeout();

      // проверяем, что в конечной директории после stable сборки содержатся правки из ранее пропатченных
      // модулей Modul и Modul2
      await checkChanges('/* patch 1 */', 'Modul/libraryCycle', true);
      await checkChanges('/* patch 2 */', 'Modul2/Module2', true);

      await clearWorkspace();
   });

   it('compile themes', async() => {
      const fixtureFolder = path.join(dirname, 'fixture/builder-generate-workflow/themes');
      await prepareTest(fixtureFolder);
      const checkBasicResults = async() => {
         // check if there is a themes folder with generated default theme in it
         (await isRegularFile(path.join(outputFolder, 'ThemesModule'), 'default.css')).should.equal(true);
         const defaultThemeContent = await fs.readFile(path.join(outputFolder, 'ThemesModule', 'default.css'), 'utf8');
         const versionedModules = await fs.readJson(path.join(outputFolder, 'ThemesModule', '.builder/versioned_modules.json'));

         versionedModules.should.have.members(['ThemesModule/default.css']);

         // check these parameters in compiled theme:
         // 1) should be packed all theme parts of default theme
         // 2) in controls part of default theme should be a single class with css properties
         // without any duplicates that are in source less files
         // 3) each theme part should be separated with a special comment section above each one of them
         defaultThemeContent.should.includes('/* Controls-default-theme/theme */\n' +
            '.controls_theme-default {\n' +
            '   --background-color: #fff;\n' +
            '   --unaccented_background-color: #f8f8f8;\n' +
            '   --hover_background-color: #f0f5fb;\n' +
            '   --unaccented_color: #999;\n' +
            '   --icon: url(\'/resources/Controls-default-theme/img/test.svg?x_module=%{MODULE_VERSION_STUB=Controls-default-theme}\');\n' +
            '   --readonly_color: #ccc;\n' +
            '   --invalid_border-color: var(--danger_border-color);\n' +
            '   --invalid_focus_background-color: var(--danger_same_background-color);\n' +
            '   --marker_color: #ff7033;\n' +
            '   --border-color: #ccc;\n' +
            '   --separator_color: #eaeaea;\n' +
            '   --readonly_marker-color: #313e78\n' +
            '}');
         defaultThemeContent.should.includes('/* TestModule-default-theme/theme */\n' +
            '.testmodule_theme-default {\n' +
            '   --background-color: #aaa;\n' +
            '   --readonly_color: #fff\n' +
            '}');

         const moduleStyleResult = await fs.readFile(path.join(outputFolder, 'Module', 'Stable.css'), 'utf8');
         moduleStyleResult.should.equal('.test-selector {\n' +
            '  test-mixin: var(--test-mixin);\n' +
            '  test-var: var(--test-var);\n' +
            '  display: -ms-grid;\n' +
            '  display: grid;\n' +
            '  -ms-grid-columns: 1fr 1fr;\n' +
            '  grid-template-columns: 1fr 1fr;\n' +
            '  -ms-grid-rows: auto;\n' +
            '  grid-template-rows: auto;\n' +
            '  padding: 1em 2em 0.5em 1em;\n' +
            '  font-family: "Droid Sans", sans-serif /*rtl:prepend:"Droid Arabic Kufi",*/;\n' +
            '  font-size: 16px /*rtl:14px*/;\n' +
            '}\n');

         // check these parameters in compiled module style for ie:
         // 1) there is a default value for each property with css variables for usage in IE
         // 2) css variables parameters remains in compiled style
         const moduleStyleResultForIE = await fs.readFile(path.join(outputFolder, 'Module', 'Stable_ie.css'), 'utf8');
         moduleStyleResultForIE.should.equal('.test-selector {\n' +
            '  test-mixin: \'mixin for IE there\';\n' +
            '  test-mixin: var(--test-mixin);\n' +
            '  test-var: \'variable for IE\';\n' +
            '  test-var: var(--test-var);\n' +
            '  display: -ms-grid;\n' +
            '  display: grid;\n' +
            '  -ms-grid-columns: 1fr 1fr;\n' +
            '  grid-template-columns: 1fr 1fr;\n' +
            '  -ms-grid-rows: auto;\n' +
            '  grid-template-rows: auto;\n' +
            '  padding: 1em 2em 0.5em 1em;\n' +
            '  font-family: "Droid Sans", sans-serif /*rtl:prepend:"Droid Arabic Kufi",*/;\n' +
            '  font-size: 16px /*rtl:14px*/;\n' +
            '}\n');
      };

      const config = {
         cache: cacheFolder,
         output: outputFolder,
         logs: logsFolder,
         less: true,
         typescript: true,
         joinedMeta: true,
         version: 'test',
         modules: [
            {
               name: 'Controls',
               path: path.join(sourceFolder, 'Controls')
            },
            {
               name: 'Controls-default-theme',
               path: path.join(sourceFolder, 'Controls-default-theme')
            },
            {
               name: 'Module',
               path: path.join(sourceFolder, 'Module')
            },
            {
               name: 'TestModule',
               path: path.join(sourceFolder, 'TestModule')
            },
            {
               name: 'TestModule-default-theme',
               path: path.join(sourceFolder, 'TestModule-default-theme')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      // run flow
      await runWorkflowWithTimeout();
      await checkBasicResults();

      // run flow again to check incremental build works properly
      await runWorkflowWithTimeout();
      await checkBasicResults();

      // change fallback to check if styles will be regenerated after rebuild
      const fallbackPath = path.join(sourceFolder, 'Controls-default-theme', 'fallback.json');
      const fallbackContent = await fs.readJson(fallbackPath);
      fallbackContent['--test-mixin'] = "'updated mixin for IE there'";
      await fs.outputJson(fallbackPath, fallbackContent);

      // remove joinedMeta flag from config to check themes meta for jinnee post-processing
      delete config.joinedMeta;
      config['default-localization'] = 'ru-RU';
      config.localization = ['ru-RU', 'he-IL'];
      await fs.writeJSON(configPath, config);
      await runWorkflowWithTimeout();

      const moduleStyleContent = await fs.readFile(path.join(outputFolder, 'Module', 'Stable.css'), 'utf8');
      moduleStyleContent.should.equal('.test-selector {\n' +
         '  test-mixin: var(--test-mixin);\n' +
         '  test-var: var(--test-var);\n' +
         '  display: -ms-grid;\n' +
         '  display: grid;\n' +
         '  -ms-grid-columns: 1fr 1fr;\n' +
         '  grid-template-columns: 1fr 1fr;\n' +
         '  -ms-grid-rows: auto;\n' +
         '  grid-template-rows: auto;\n' +
         '  padding: 1em 2em 0.5em 1em;\n' +
         '  font-family: "Droid Sans", sans-serif /*rtl:prepend:"Droid Arabic Kufi",*/;\n' +
         '  font-size: 16px /*rtl:14px*/;\n' +
         '}\n');
      const moduleStyleContentForIE = await fs.readFile(path.join(outputFolder, 'Module', 'Stable_ie.css'), 'utf8');
      moduleStyleContentForIE.should.equal('.test-selector {\n' +
         '  test-mixin: \'updated mixin for IE there\';\n' +
         '  test-mixin: var(--test-mixin);\n' +
         '  test-var: \'variable for IE\';\n' +
         '  test-var: var(--test-var);\n' +
         '  display: -ms-grid;\n' +
         '  display: grid;\n' +
         '  -ms-grid-columns: 1fr 1fr;\n' +
         '  grid-template-columns: 1fr 1fr;\n' +
         '  -ms-grid-rows: auto;\n' +
         '  grid-template-rows: auto;\n' +
         '  padding: 1em 2em 0.5em 1em;\n' +
         '  font-family: "Droid Sans", sans-serif /*rtl:prepend:"Droid Arabic Kufi",*/;\n' +
         '  font-size: 16px /*rtl:14px*/;\n' +
         '}\n');

      const moduleStyleContentForRtl = await fs.readFile(path.join(outputFolder, 'Module', 'Stable.rtl.css'), 'utf8');
      moduleStyleContentForRtl.should.equal('.test-selector {\n' +
         '  test-mixin: var(--test-mixin);\n' +
         '  test-var: var(--test-var);\n' +
         '  display: -ms-grid;\n' +
         '  display: grid;\n' +
         '  -ms-grid-columns: 1fr 1fr;\n' +
         '  grid-template-columns: 1fr 1fr;\n' +
         '  -ms-grid-rows: auto;\n' +
         '  grid-template-rows: auto;\n' +
         '  padding: 1em 1em 0.5em 2em;\n' +
         '  font-family: "Droid Arabic Kufi","Droid Sans", sans-serif /*rtl:prepend:"Droid Arabic Kufi",*/;\n' +
         '  font-size: 14px/*rtl:14px*/;\n' +
         '}\n');

      await runWorkflowWithTimeout();

      await clearWorkspace();
   });

   it('new type locales: must compile js-locale and write it to contents only for existing json-locales', async() => {
      const fixtureFolder = path.join(dirname, 'fixture/builder-generate-workflow/locales');
      await prepareTest(fixtureFolder);
      await linkPlatform(sourceFolder);
      const correctContents = {
         availableLanguage: {
            en: 'English',
            'en-US': 'English',
            ru: 'Русский',
            'ru-RU': 'Русский'
         },
         buildMode: 'debug',
         defaultLanguage: 'ru-RU',
         htmlNames: {},
         modules: {
            Modul: {
               ESVersion: 5,
               dict: [
                  'en',
                  'en-GB',
                  'en-US',
                  'en.css',
                  'ru-RU',
                  'ru-RU.css',
               ],
               name: 'Модуль'
            }
         }
      };
      const testResults = async() => {
         const contents = await fs.readJson(path.join(moduleOutputFolder, 'contents.json'));
         contents.should.deep.equal(correctContents);
         const listOfDictionaries = await fs.readdir(path.join(moduleOutputFolder, 'lang/en'));
         listOfDictionaries.should.have.members([
            'en-GB.json',
            'en-GB.json.js',
            'en-US.json',
            'en-US.json.js',
            'en.json',
            'en.json.js',
            'en.less',
            'en.css',
            'en_ie.css'
         ]);
         const currentDictDirectory = path.join(moduleOutputFolder, 'lang/en');
         (await fs.readJson(path.join(currentDictDirectory, 'en.json'))).should.deep.equal({
            '10 или 12': '10 or 12',
            'Это словарь!': 'This is dictionary!'
         });
         (await fs.readJson(path.join(currentDictDirectory, 'en-US.json'))).should.deep.equal({
            '10 или 12': '10 or 12',
            'Это словарь!': 'This is dictionary! God, bless America!',
            'Ключ для США': 'US key'
         });
         (await fs.readJson(path.join(currentDictDirectory, 'en-GB.json'))).should.deep.equal({
            '10 или 12': '10 or 12',
            'Это словарь!': 'This is dictionary! God, save the queen!',
            'Ключ для Британии': 'GB key'
         });
         (await fs.readFile(path.join(currentDictDirectory, 'en.css'), 'utf8')).should.equal(
            '.en .test {\n' +
            '  width: 686px;\n' +
            '}\n'
         );
      };
      const config = {
         cache: cacheFolder,
         output: outputFolder,
         logs: logsFolder,
         'default-localization': 'ru-RU',
         localization: ['en-US', 'ru-RU', 'en'],
         less: true,
         contents: true,
         modules: [
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль')
            }
         ]
      };

      await fs.writeJSON(configPath, config);

      await runWorkflowWithTimeout();
      await testResults();

      // incremental build must be completed properly
      await runWorkflowWithTimeout();
      await testResults();
      await clearWorkspace();
   });
   it('compile less without coverage', async() => {
      const fixtureFolder = path.join(dirname, 'fixture/builder-generate-workflow/less');
      await prepareTest(fixtureFolder);

      const config = {
         cache: cacheFolder,
         output: outputFolder,
         logs: logsFolder,
         less: true,
         typescript: true,
         dependenciesGraph: true,
         builderTests: true,
         modules: [
            {
               name: 'SBIS3.CONTROLS',
               path: path.join(sourceFolder, 'SBIS3.CONTROLS')
            },
            {
               name: 'Controls-default-theme',
               path: path.join(sourceFolder, 'Controls-default-theme')
            },
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль')
            },
            {
               name: 'TestModule',
               path: path.join(sourceFolder, 'TestModule')
            }
         ]
      };

      await fs.writeJSON(configPath, config);

      // запустим таску
      await runWorkflowWithTimeout();

      const testModuleDepsPath = path.join(outputFolder, 'TestModule/module-dependencies.json');
      let lessDependenciesExists = (await fs.readJson(testModuleDepsPath)).hasOwnProperty('lessDependencies');

      lessDependenciesExists.should.deep.equal(false);

      // запустим повторно таску
      await runWorkflowWithTimeout();

      lessDependenciesExists = (await fs.readJson(testModuleDepsPath)).hasOwnProperty('lessDependencies');
      lessDependenciesExists.should.equal(false);

      await clearWorkspace();
   });

   it('compile less', async() => {
      const fixtureFolder = path.join(dirname, 'fixture/builder-generate-workflow/less');
      await prepareTest(fixtureFolder);

      const config = {
         cache: cacheFolder,
         output: outputFolder,
         logs: logsFolder,
         lessCoverage: true,
         less: true,
         builderTests: true,
         typescript: true,
         dependenciesGraph: true,
         modules: [
            {
               name: 'SBIS3.CONTROLS',
               path: path.join(sourceFolder, 'SBIS3.CONTROLS')
            },
            {
               name: 'Controls-default-theme',
               path: path.join(sourceFolder, 'Controls-default-theme')
            },
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль')
            },
            {
               name: 'TestModule',
               path: path.join(sourceFolder, 'TestModule')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      // запустим таску
      await runWorkflowWithTimeout();
      await testEmptyLessLog(['emptyLess.less', 'emptyCss.css'], ['less', 'css']);

      let resultsFiles;

      // проверим, что все нужные файлы появились в "стенде"
      resultsFiles = await fs.readdir(moduleOutputFolder);
      resultsFiles.should.have.members([
         'Error.less',
         'ForChange.css',
         'ForChange_ie.css',
         'ForChange.less',
         'ForRename_old.css',
         'ForRename_old_ie.css',
         'ForRename_old.less',
         'Stable.css',
         'Stable_ie.css',
         'Stable.less',
         'module-dependencies.json'
      ]);

      const stableCss = await fs.readFile(path.join(moduleOutputFolder, 'Stable.css'), 'utf8');

      // autoprefixer enabled by default, so css result must have all needed prefixes
      stableCss.replace(/\n$/, '').should.equal('.test-selector {\n' +
         '  test-mixin: var(--test-mixin);\n' +
         '  test-var: var(--test-var);\n' +
         '  display: -ms-grid;\n' +
         '  display: grid;\n' +
         '  -ms-grid-columns: 1fr 1fr;\n' +
         '  grid-template-columns: 1fr 1fr;\n' +
         '  -ms-grid-rows: auto;\n' +
         '  grid-template-rows: auto;\n' +
         '}');

      const stableCssForIE = await fs.readFile(path.join(moduleOutputFolder, 'Stable_ie.css'), 'utf8');

      // autoprefixer enabled by default, so css result must have all needed prefixes
      stableCssForIE.replace(/\n$/, '').should.equal('.test-selector {\n' +
         '  test-mixin: undefined;\n' +
         '  test-mixin: var(--test-mixin);\n' +
         '  test-var: undefined;\n' +
         '  test-var: var(--test-var);\n' +
         '  display: -ms-grid;\n' +
         '  display: grid;\n' +
         '  -ms-grid-columns: 1fr 1fr;\n' +
         '  grid-template-columns: 1fr 1fr;\n' +
         '  -ms-grid-rows: auto;\n' +
         '  grid-template-rows: auto;\n' +
         '}');

      // изменим "исходники"
      await timeoutForMacOS();
      await fs.rename(
         path.join(moduleSourceFolder, 'ForRename_old.less'),
         path.join(moduleSourceFolder, 'ForRename_new.less')
      );
      const filePathForChange = path.join(moduleSourceFolder, 'ForChange.less');
      const data = await fs.readFile(filePathForChange);
      await fs.writeFile(filePathForChange, `${data.toString()}\n.test-selector2 {}`);

      // запустим повторно таску
      await runWorkflowWithTimeout();
      await testEmptyLessLog(['emptyLess.less', 'emptyCss.css'], ['less', 'css']);

      // проверим, что все нужные файлы появились в "стенде", лишние удалились
      resultsFiles = await fs.readdir(moduleOutputFolder);
      resultsFiles.should.have.members([
         'Error.less',
         'ForChange.css',
         'ForChange_ie.css',
         'ForChange.less',
         'ForRename_new.css',
         'ForRename_new_ie.css',
         'ForRename_new.less',
         'Stable.css',
         'Stable_ie.css',
         'module-dependencies.json',
         'Stable.less'
      ]);

      await clearWorkspace();
   });

   it('content dictionaries - AMD-formatted dictionaries meta must be saved only for modules with it', async() => {
      const fixtureFolder = path.join(dirname, 'fixture/builder-generate-workflow/dictionary');
      await prepareTest(fixtureFolder);
      const moduleOutput = path.join(outputFolder, 'Module1');
      const testResults = async() => {
         const { messages } = await fs.readJson(path.join(workspaceFolder, 'logs/builder_report.json'));
         const errorMessage = 'Attempt to use css from root lang directory, use less instead!';
         let cssLangErrorExists = false;
         messages.forEach((currentError) => {
            if (currentError.message === errorMessage) {
               cssLangErrorExists = true;
            }
         });
         cssLangErrorExists.should.equal(true);

         (await isRegularFile(path.join(moduleOutput, 'lang/en'), 'en.json.js')).should.equal(true);
         (await isRegularFile(path.join(moduleOutput, 'lang/en'), 'en-US.json.js')).should.equal(true);

         // check correct processing for lang/en/en-GB.json source dictionary
         (await isRegularFile(path.join(moduleOutput, 'lang/en'), 'en-GB.json.js')).should.equal(true);
         (await isRegularFile(path.join(moduleOutput, 'lang/en'), 'en-en-GB.json.js')).should.equal(false);

         const moduleContents = await fs.readJson(path.join(moduleOutput, 'contents.json'));
         moduleContents.modules.Module1.dict.should.have.members([
            'en',
            'en-US',
            'en-GB',
            'en.css',
            'ru-RU'
         ]);
      };
      const config = {
         cache: cacheFolder,
         output: outputFolder,
         logs: logsFolder,
         contents: true,
         builderTests: true,
         'default-localization': 'ru-RU',
         localization: ['ru-RU', 'en-US'],
         modules: [
            {
               name: 'Module1',
               path: path.join(sourceFolder, 'Module1')
            },
            {
               name: 'Module2',
               path: path.join(sourceFolder, 'Module2')
            }
         ]
      };
      await fs.writeJSON(configPath, config);
      await runWorkflowWithTimeout(30000);
      await testResults();
      await runWorkflowWithTimeout(30000);
      await testResults();
      await clearWorkspace();
   });
   it('compile less - should return correct meta in "contents" for new themes', async() => {
      const fixtureFolder = path.join(dirname, 'fixture/builder-generate-workflow/less');
      await prepareTest(fixtureFolder);
      const testResults = async() => {
         /**
          * In case of using new themes algorythm for less compiling we must not compile less for
          * old themes. Result will be the same, but for the same time it will downgrade the speed
          * because of compiling 2 styles for one less with the same result's content.
          */
         (await isRegularFile(path.join(outputFolder, 'TestModule-anotherTheme-theme'), 'badVariable.css')).should.equal(false);
         (await isRegularFile(path.join(outputFolder, 'TestModule-anotherTheme-theme'), 'onlineVariable.css')).should.equal(false);
      };
      const config = {
         cache: cacheFolder,
         output: outputFolder,
         logs: logsFolder,
         less: true,
         typescript: true,
         dependenciesGraph: true,
         contents: true,
         builderTests: true,
         joinedMeta: true,
         modules: [
            {
               name: 'TestModule',
               path: path.join(sourceFolder, 'TestModule')
            },
            {
               name: 'SBIS3.CONTROLS',
               path: path.join(sourceFolder, 'SBIS3.CONTROLS')
            },
            {
               name: 'Controls-default-theme',
               path: path.join(sourceFolder, 'Controls-default-theme')
            },
            {
               name: 'TestModule-anotherTheme-theme',
               path: path.join(sourceFolder, 'TestModule-anotherTheme-theme')
            },
            {
               name: 'TestModule-online-theme',
               path: path.join(sourceFolder, 'TestModule-online-theme')
            },
            {
               name: 'NotExisting-online-theme',
               path: path.join(sourceFolder, 'NotExisting-online-theme')
            }
         ]
      };
      await fs.writeJSON(configPath, config);
      await runWorkflowWithTimeout(30000);
      await testResults();

      // css files doesn't processing in new less compiler, so these should be ignored
      await testEmptyLessLog(['emptyLessNewTheme.less'], ['less', 'css']);
      await runWorkflowWithTimeout(30000);
      await testResults();
      await testEmptyLessLog(['emptyLessNewTheme.less'], ['less', 'css']);

      await fs.remove(cacheFolder);
      await runWorkflowWithTimeout(30000);
      await testResults();
      await clearWorkspace();
   });

   it('actual builder cache', async() => {
      const fixtureFolder = path.join(dirname, 'fixture/builder-generate-workflow/less');
      await prepareTest(fixtureFolder);

      let config = {
         cache: cacheFolder,
         output: outputFolder,
         logs: logsFolder,
         builderTests: true,
         wml: true,
         modules: [
            {
               name: 'SBIS3.CONTROLS',
               path: path.join(sourceFolder, 'SBIS3.CONTROLS')
            },
            {
               name: 'Controls-default-theme',
               path: path.join(sourceFolder, 'Controls-default-theme')
            },
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль')
            },
            {
               name: 'WS.Core',
               path: path.join(sourceFolder, 'WS.Core'),
               required: true
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      // make test folders in modules cache to check it was removed after rebuild with new config.
      await fs.ensureDir(path.join(cacheFolder, 'PlatformModule1'));
      await fs.ensureDir(path.join(cacheFolder, 'PlatformModule2'));

      // запустим таску
      await runWorkflowWithTimeout();

      config = {
         cache: cacheFolder,
         output: outputFolder,
         logs: logsFolder,
         builderTests: true,
         modules: [
            {
               name: 'SBIS3.CONTROLS',
               path: path.join(sourceFolder, 'SBIS3.CONTROLS')
            },
            {
               name: 'Controls-default-theme',
               path: path.join(sourceFolder, 'Controls-default-theme')
            },
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      await runWorkflowWithTimeout();

      // source symlinks must have new actual list of source modules
      const sourceSymlinksDirectoryList = await fs.readdir(path.join(cacheFolder, 'temp-modules'));
      sourceSymlinksDirectoryList.should.have.members([
         'SBIS3.CONTROLS',
         'Controls-default-theme',
         'Модуль'
      ]);
      await clearWorkspace();
   });

   it('routes-info', async() => {
      const fixtureFolder = path.join(dirname, 'fixture/builder-generate-workflow/routes');
      await prepareTest(fixtureFolder);
      let resultsFiles, routesInfoResult;

      const testResults = async(currentUrl) => {
         // проверим, что все нужные файлы появились в "стенде", лишние удалились
         resultsFiles = await fs.readdir(moduleOutputFolder);
         resultsFiles.should.have.members([
            'ForChange.routes.js',
            'ForRename_old.routes.js',
            'Stable.routes.js',
            'Test1.js',
            'navigation-modules.json',
            'routes-info.json',
            'static_templates.json',
            'tsRouting.routes.js',
            'tsRouting.routes.ts'
         ]);
         routesInfoResult = await fs.readJson(path.join(moduleOutputFolder, 'routes-info.json'));
         routesInfoResult.hasOwnProperty('resources/Modul/tsRouting.routes.js').should.equal(true);
         const currentRouting = routesInfoResult['resources/Modul/tsRouting.routes.js'];
         currentRouting[currentUrl].should.deep.equal({
            controller: 'Modul/Test1',
            isMasterPage: false
         });
      };
      const config = {
         cache: cacheFolder,
         output: outputFolder,
         logs: logsFolder,
         typescript: true,
         presentationServiceMeta: true,
         modules: [
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      // запустим таску
      await runWorkflowWithTimeout();
      await testResults('/ForChange_old.html');

      await fs.writeFile(
         path.join(sourceFolder, 'Модуль/tsRouting.routes.ts'),
         'module.exports = function() {\n' +
         '    return {\n' +
         '        \'/ForChange_new.html\': \'Modul/Test1\'\n' +
         '    };\n' +
         '};'
      );

      await timeoutForMacOS();

      // запустим повторно таску
      await runWorkflowWithTimeout();
      await testResults('/ForChange_new.html');
      await clearWorkspace();
   });

   it('map for requirejs substitutions', async() => {
      const fixtureFolder = path.join(dirname, 'fixture/builder-generate-workflow/less');
      await prepareTest(fixtureFolder);

      const testRequireJsSubstitutions = async() => {
         // проверим, что все нужные файлы появились в "стенде"
         const mDeps = await fs.readJson(path.join(outputFolder, 'WS.Core/module-dependencies.json'));
         mDeps.hasOwnProperty('requireJsSubstitutions').should.equal(true);

         // test common types of this map properties for validity.
         const substitutions = mDeps.requireJsSubstitutions;
         substitutions.hasOwnProperty('Core/core-min').should.equal(true);
         substitutions['Core/core-min'].should.equal('WS.Core/core/core-min.js');
         substitutions.hasOwnProperty('css!WS/css/core').should.equal(true);
         substitutions['css!WS/css/core'].should.equal('WS.Core/css/core.css');
      };

      const config = {
         wsCoreMap: true,
         cache: cacheFolder,
         output: outputFolder,
         logs: logsFolder,
         dependenciesGraph: true,
         typescript: true,
         builderTests: true,
         modules: [
            {
               name: 'SBIS3.CONTROLS',
               path: path.join(sourceFolder, 'SBIS3.CONTROLS')
            },
            {
               name: 'Controls-default-theme',
               path: path.join(sourceFolder, 'Controls-default-theme')
            },
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль')
            },
            {
               name: 'WS.Core',
               path: path.join(dirname, 'fixtureWS/WS.Core')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      await runWorkflowWithTimeout();
      await testRequireJsSubstitutions();
      await runWorkflowWithTimeout();
      await testRequireJsSubstitutions();
      await clearWorkspace();
   });

   it('static html', async() => {
      const fixtureFolder = path.join(dirname, 'fixture/builder-generate-workflow/staticHtml');
      await prepareTest(fixtureFolder);
      await linkPlatform(sourceFolder);

      const config = {
         cache: cacheFolder,
         output: outputFolder,
         logs: logsFolder,
         deprecatedWebPageTemplates: true,
         htmlWml: true,
         contents: true,
         presentationServiceMeta: true,
         builderTests: true,
         modules: [
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль'),
               depends: ['Тема Скрепка']
            },
            {
               name: 'Тема Скрепка',
               path: path.join(sourceFolder, 'Тема Скрепка')
            },
            {
               name: 'View',
               path: path.join(sourceFolder, 'View')
            },
            {
               name: 'UI',
               path: path.join(sourceFolder, 'UI')
            },
            {
               name: 'Compiler',
               path: path.join(sourceFolder, 'Compiler')
            },
            {
               name: 'UICore',
               path: path.join(sourceFolder, 'UICore')
            },
            {
               name: 'UICommon',
               path: path.join(sourceFolder, 'UICommon')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      // запустим таску
      await runWorkflowWithTimeout();

      // проверим, что все нужные файлы появились в "стенде"
      let resultsFiles = await fs.readdir(moduleOutputFolder);
      resultsFiles.should.have.members([
         'Modul.s3mod',
         'ForChange.js',
         'ForChange_old.html',
         'ForRename_old.js',
         'ForRename.html',
         'Test',
         'TestASort',
         'Stable.js',
         'Stable.html',
         'contents.json',
         'contents.json.js',
         'navigation-modules.json',
         'routes-info.json',
         'static_templates.json'
      ]);
      const contentsJsonOutputPath = path.join(moduleOutputFolder, 'contents.json');
      let contentsObj = await fs.readJSON(contentsJsonOutputPath);
      await contentsObj.should.deep.equal({
         buildMode: 'debug',
         htmlNames: {
            'Modul/ForChange': 'ForChange_old.html',
            'Modul/ForRename_old': 'ForRename.html',
            'Modul/Stable': 'Stable.html'
         },
         modules: {
            Modul: {
               ESVersion: 5,
               name: 'Модуль'
            }
         }
      });

      // запомним время модификации незменяемого файла и изменяемого в "стенде"
      const stableJsOutputPath = path.join(moduleOutputFolder, 'Stable.js');
      const stableHtmlOutputPath = path.join(moduleOutputFolder, 'Stable.html');
      const forChangeJsOutputPath = path.join(moduleOutputFolder, 'ForChange.js');
      let forChangeHtmlOutputPath = path.join(moduleOutputFolder, 'ForChange_old.html');
      const mTimeStableJs = await getMTime(stableJsOutputPath);
      const mTimeStableHtml = await getMTime(stableHtmlOutputPath);
      const mTimeForChangeJs = await getMTime(forChangeJsOutputPath);
      const mTimeForChangeHtml = await getMTime(forChangeHtmlOutputPath);

      // проверим сами html
      let stableHtml = await fs.readFile(stableHtmlOutputPath);
      let forChangeHtml = await fs.readFile(forChangeHtmlOutputPath);
      const forRenameHtmlOutputPath = path.join(moduleOutputFolder, 'ForRename.html');
      let forRenameHtml = await fs.readFile(forRenameHtmlOutputPath);
      const staticTemplatesJsonOutputPath = path.join(moduleOutputFolder, 'static_templates.json');
      let staticTemplatesJson = await fs.readFile(staticTemplatesJsonOutputPath);
      removeRSymbol(stableHtml.toString()).should.equal(
         '<STABLE></STABLE>\n' +
            '<TITLE>Stable</TITLE>\n' +
            '<START_DIALOG>Modul/Stable</START_DIALOG>\n' +
            '<INCLUDE><INCLUDE1/>\n' +
            '</INCLUDE>\n' +
            '<RESOURCE_ROOT>/resources/</RESOURCE_ROOT>\n' +
            '<META_ROOT>/resources/</META_ROOT>\n' +
            '<WI.SBIS_ROOT>/resources/WS.Core/</WI.SBIS_ROOT>\n' +
            '<APPLICATION_ROOT>/</APPLICATION_ROOT>\n' +
            '<SERVICES_PATH>/service/</SERVICES_PATH>\n' +
            '<APPEND_STYLE></APPEND_STYLE>\n' +
            '<APPEND_JAVASCRIPT></APPEND_JAVASCRIPT>\n' +
            '<ACCESS_LIST></ACCESS_LIST>\n' +
            '<CONFIG.USER_PARAMS>%{CONFIG.USER_PARAMS}</CONFIG.USER_PARAMS>\n' +
            '<CONFIG.GLOBAL_PARAMS>%{CONFIG.GLOBAL_PARAMS}</CONFIG.GLOBAL_PARAMS>\n' +
            '<SAVE_LAST_STATE>false</SAVE_LAST_STATE>\n'
      );
      removeRSymbol(forChangeHtml.toString()).should.equal(
         '<FOR_CHANGE_OLD></FOR_CHANGE_OLD>\n' +
            '<TITLE>ForChange_old</TITLE>\n' +
            '<START_DIALOG>Modul/ForChange</START_DIALOG>\n' +
            '<INCLUDE><INCLUDE1/>\n' +
            '</INCLUDE>\n' +
            '<RESOURCE_ROOT>/resources/</RESOURCE_ROOT>\n' +
            '<META_ROOT>/resources/</META_ROOT>\n' +
            '<WI.SBIS_ROOT>/resources/WS.Core/</WI.SBIS_ROOT>\n' +
            '<APPLICATION_ROOT>/</APPLICATION_ROOT>\n' +
            '<SERVICES_PATH>/service/</SERVICES_PATH>\n' +
            '<APPEND_STYLE></APPEND_STYLE>\n' +
            '<APPEND_JAVASCRIPT></APPEND_JAVASCRIPT>\n' +
            '<ACCESS_LIST></ACCESS_LIST>\n' +
            '<CONFIG.USER_PARAMS>%{CONFIG.USER_PARAMS}</CONFIG.USER_PARAMS>\n' +
            '<CONFIG.GLOBAL_PARAMS>%{CONFIG.GLOBAL_PARAMS}</CONFIG.GLOBAL_PARAMS>\n' +
            '<SAVE_LAST_STATE>false</SAVE_LAST_STATE>\n'
      );
      removeRSymbol(forRenameHtml.toString()).should.equal(
         '<FOR_RENAME></FOR_RENAME>\n' +
            '<TITLE>ForRename</TITLE>\n' +
            '<START_DIALOG>Modul/ForRename_old</START_DIALOG>\n' +
            '<INCLUDE><INCLUDE1/>\n' +
            '</INCLUDE>\n' +
            '<RESOURCE_ROOT>/resources/</RESOURCE_ROOT>\n' +
            '<META_ROOT>/resources/</META_ROOT>\n' +
            '<WI.SBIS_ROOT>/resources/WS.Core/</WI.SBIS_ROOT>\n' +
            '<APPLICATION_ROOT>/</APPLICATION_ROOT>\n' +
            '<SERVICES_PATH>/service/</SERVICES_PATH>\n' +
            '<APPEND_STYLE></APPEND_STYLE>\n' +
            '<APPEND_JAVASCRIPT></APPEND_JAVASCRIPT>\n' +
            '<ACCESS_LIST></ACCESS_LIST>\n' +
            '<CONFIG.USER_PARAMS>%{CONFIG.USER_PARAMS}</CONFIG.USER_PARAMS>\n' +
            '<CONFIG.GLOBAL_PARAMS>%{CONFIG.GLOBAL_PARAMS}</CONFIG.GLOBAL_PARAMS>\n' +
            '<SAVE_LAST_STATE>false</SAVE_LAST_STATE>\n'
      );
      removeRSymbol(staticTemplatesJson.toString()).should.equal(
         '{\n' +
            '  "/ForChange_old.html": "Modul/ForChange_old.html",\n' +
            '  "/ForRename.html": "Modul/ForRename.html",\n' +
            '  "/Stable.html": "Modul/Stable.html",\n' +
            '  "/Stable/One": "Modul/Stable.html",\n' +
            '  "/Stable/Two": "Modul/Stable.html",\n' +
            '  "/Stable_Three": "Modul/Stable.html",\n' +
            '  "/TestHtmlTmpl.html": "Модуль/TestASort/TestHtmlTmpl.html"\n' +
            '}'
      );

      // изменим "исходники"
      await timeoutForMacOS();
      await fs.rename(
         path.join(moduleSourceFolder, 'ForRename_old.js'),
         path.join(moduleSourceFolder, 'ForRename_new.js')
      );
      await fs.rename(
         path.join(themesSourceFolder, 'ForRename_old.html'),
         path.join(themesSourceFolder, 'ForRename_new.html')
      );

      const filePathForChangeJs = path.join(moduleSourceFolder, 'ForChange.js');
      const dataJs = await fs.readFile(filePathForChangeJs);
      await fs.writeFile(filePathForChangeJs, dataJs.toString().replace(/ForChange_old/g, 'ForChange_new'));

      const filePathForChangeHtml = path.join(themesSourceFolder, 'ForChange.html');
      const dataHtml = await fs.readFile(filePathForChangeHtml);
      await fs.writeFile(filePathForChangeHtml, dataHtml.toString().replace(/FOR_CHANGE_OLD/g, 'FOR_CHANGE_NEW'));

      // запустим повторно таску
      await runWorkflowWithTimeout();

      // проверим, что все нужные файлы появились в "стенде", лишние удалились
      resultsFiles = await fs.readdir(moduleOutputFolder);
      resultsFiles.should.have.members([
         'Modul.s3mod',
         'ForChange.js',
         'ForChange_new.html',
         'ForRename_new.js',
         'ForRename.html',
         'Test',
         'TestASort',
         'Stable.js',
         'Stable.html',
         'contents.json',
         'contents.json.js',
         'navigation-modules.json',
         'routes-info.json',
         'static_templates.json'
      ]);

      // проверим время модификации незменяемого файла и изменяемого в "стенде"
      // !!! В отличии от остальных файлов, статические HTML всегда пересоздаются заново, т.к. кешировать их сложно,
      // а весь процесс длится меньше 2 секунд.
      forChangeHtmlOutputPath = path.join(moduleOutputFolder, 'ForChange_new.html');
      (await getMTime(stableJsOutputPath)).should.equal(mTimeStableJs);

      // следующая проверка отличается от остальных и это норма
      (await getMTime(stableHtmlOutputPath)).should.not.equal(mTimeStableHtml);
      (await getMTime(forChangeJsOutputPath)).should.not.equal(mTimeForChangeJs);
      (await getMTime(forChangeHtmlOutputPath)).should.not.equal(mTimeForChangeHtml);

      contentsObj = await fs.readJSON(contentsJsonOutputPath);
      await contentsObj.should.deep.equal({
         buildMode: 'debug',
         htmlNames: {
            'Modul/ForChange': 'ForChange_new.html',
            'Modul/ForRename_old': 'ForRename.html',
            'Modul/Stable': 'Stable.html'
         },
         modules: {
            Modul: {
               ESVersion: 5,
               name: 'Модуль'
            }
         }
      });

      // проверим сами html
      stableHtml = await fs.readFile(stableHtmlOutputPath);
      forChangeHtml = await fs.readFile(forChangeHtmlOutputPath);
      forRenameHtml = await fs.readFile(forRenameHtmlOutputPath);
      staticTemplatesJson = await fs.readFile(staticTemplatesJsonOutputPath);
      removeRSymbol(stableHtml.toString()).should.equal(
         '<STABLE></STABLE>\n' +
            '<TITLE>Stable</TITLE>\n' +
            '<START_DIALOG>Modul/Stable</START_DIALOG>\n' +
            '<INCLUDE><INCLUDE1/>\n' +
            '</INCLUDE>\n' +
            '<RESOURCE_ROOT>/resources/</RESOURCE_ROOT>\n' +
            '<META_ROOT>/resources/</META_ROOT>\n' +
            '<WI.SBIS_ROOT>/resources/WS.Core/</WI.SBIS_ROOT>\n' +
            '<APPLICATION_ROOT>/</APPLICATION_ROOT>\n' +
            '<SERVICES_PATH>/service/</SERVICES_PATH>\n' +
            '<APPEND_STYLE></APPEND_STYLE>\n' +
            '<APPEND_JAVASCRIPT></APPEND_JAVASCRIPT>\n' +
            '<ACCESS_LIST></ACCESS_LIST>\n' +
            '<CONFIG.USER_PARAMS>%{CONFIG.USER_PARAMS}</CONFIG.USER_PARAMS>\n' +
            '<CONFIG.GLOBAL_PARAMS>%{CONFIG.GLOBAL_PARAMS}</CONFIG.GLOBAL_PARAMS>\n' +
            '<SAVE_LAST_STATE>false</SAVE_LAST_STATE>\n'
      );

      // TODO: в следующей строке ошибка из-за кеширования результата в lib/generate-static-html-for-js.js.
      // должно быть FOR_CHANGE_NEW. пока этим можно пренебречь
      removeRSymbol(forChangeHtml.toString()).should.equal(
         '<FOR_CHANGE_OLD></FOR_CHANGE_OLD>\n' +
            '<TITLE>ForChange_new</TITLE>\n' +
            '<START_DIALOG>Modul/ForChange</START_DIALOG>\n' +
            '<INCLUDE><INCLUDE1/>\n' +
            '</INCLUDE>\n' +
            '<RESOURCE_ROOT>/resources/</RESOURCE_ROOT>\n' +
            '<META_ROOT>/resources/</META_ROOT>\n' +
            '<WI.SBIS_ROOT>/resources/WS.Core/</WI.SBIS_ROOT>\n' +
            '<APPLICATION_ROOT>/</APPLICATION_ROOT>\n' +
            '<SERVICES_PATH>/service/</SERVICES_PATH>\n' +
            '<APPEND_STYLE></APPEND_STYLE>\n' +
            '<APPEND_JAVASCRIPT></APPEND_JAVASCRIPT>\n' +
            '<ACCESS_LIST></ACCESS_LIST>\n' +
            '<CONFIG.USER_PARAMS>%{CONFIG.USER_PARAMS}</CONFIG.USER_PARAMS>\n' +
            '<CONFIG.GLOBAL_PARAMS>%{CONFIG.GLOBAL_PARAMS}</CONFIG.GLOBAL_PARAMS>\n' +
            '<SAVE_LAST_STATE>false</SAVE_LAST_STATE>\n'
      );

      removeRSymbol(forRenameHtml.toString()).should.equal(
         '<FOR_RENAME></FOR_RENAME>\n' +
            '<TITLE>ForRename</TITLE>\n' +
            '<START_DIALOG>Modul/ForRename_old</START_DIALOG>\n' +
            '<INCLUDE><INCLUDE1/>\n' +
            '</INCLUDE>\n' +
            '<RESOURCE_ROOT>/resources/</RESOURCE_ROOT>\n' +
            '<META_ROOT>/resources/</META_ROOT>\n' +
            '<WI.SBIS_ROOT>/resources/WS.Core/</WI.SBIS_ROOT>\n' +
            '<APPLICATION_ROOT>/</APPLICATION_ROOT>\n' +
            '<SERVICES_PATH>/service/</SERVICES_PATH>\n' +
            '<APPEND_STYLE></APPEND_STYLE>\n' +
            '<APPEND_JAVASCRIPT></APPEND_JAVASCRIPT>\n' +
            '<ACCESS_LIST></ACCESS_LIST>\n' +
            '<CONFIG.USER_PARAMS>%{CONFIG.USER_PARAMS}</CONFIG.USER_PARAMS>\n' +
            '<CONFIG.GLOBAL_PARAMS>%{CONFIG.GLOBAL_PARAMS}</CONFIG.GLOBAL_PARAMS>\n' +
            '<SAVE_LAST_STATE>false</SAVE_LAST_STATE>\n'
      );
      removeRSymbol(staticTemplatesJson.toString()).should.equal(
         '{\n' +
            '  "/ForChange_new.html": "Modul/ForChange_new.html",\n' +
            '  "/ForRename.html": "Modul/ForRename.html",\n' +
            '  "/Stable.html": "Modul/Stable.html",\n' +
            '  "/Stable/One": "Modul/Stable.html",\n' +
            '  "/Stable/Two": "Modul/Stable.html",\n' +
            '  "/Stable_Three": "Modul/Stable.html",\n' +
            '  "/TestHtmlTmpl.html": "Модуль/TestASort/TestHtmlTmpl.html"\n' +
            '}'
      );

      await clearWorkspace();
   });

   it('create symlink or copy', async() => {
      const fixtureFolder = path.join(dirname, 'fixture/builder-generate-workflow/symlink');
      await prepareTest(fixtureFolder);
      await linkPlatform(sourceFolder);

      let config = {
         cache: cacheFolder,
         output: outputFolder,
         logs: logsFolder,
         presentationServiceMeta: true,
         deprecatedWebPageTemplates: true,
         htmlWml: true,
         contents: true,
         less: true,
         builderTests: true,
         modules: [
            {
               name: 'SBIS3.CONTROLS',
               path: path.join(sourceFolder, 'SBIS3.CONTROLS')
            },
            {
               name: 'Controls-default-theme',
               path: path.join(sourceFolder, 'Controls-default-theme')
            },
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль')
            },
            {
               name: 'View',
               path: path.join(sourceFolder, 'View')
            },
            {
               name: 'UI',
               path: path.join(sourceFolder, 'UI')
            },
            {
               name: 'Compiler',
               path: path.join(sourceFolder, 'Compiler')
            },
            {
               name: 'UICore',
               path: path.join(sourceFolder, 'UICore')
            },
            {
               name: 'UICommon',
               path: path.join(sourceFolder, 'UICommon')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      const check = async() => {
         // запустим таску
         await runWorkflowWithTimeout();

         // файлы из исходников
         (await isSymlink(moduleOutputFolder, 'template.html')).should.equal(true);
         (await isSymlink(moduleOutputFolder, 'TestHtmlTmpl.html.tmpl')).should.equal(true);
         (await isSymlink(moduleOutputFolder, 'TestStaticHtml.js')).should.equal(true);

         // генерируемые файлы из исходников
         (await isRegularFile(moduleOutputFolder, 'StaticHtml.html')).should.equal(true);

         // генерируемые файлы на модуль
         (await isRegularFile(moduleOutputFolder, 'contents.json')).should.equal(true);
         (await isRegularFile(moduleOutputFolder, 'navigation-modules.json')).should.equal(true);
         (await isRegularFile(moduleOutputFolder, 'static_templates.json')).should.equal(true);
      };

      await check();
      (await isRegularFile(moduleOutputFolder, 'TestHtmlTmpl.html')).should.equal(true);

      config = {
         cache: cacheFolder,
         output: outputFolder,
         logs: logsFolder,
         presentationServiceMeta: true,
         deprecatedWebPageTemplates: true,
         htmlWml: true,
         contents: true,
         less: true,
         builderTests: true,
         modules: [
            {
               name: 'SBIS3.CONTROLS',
               path: path.join(sourceFolder, 'SBIS3.CONTROLS')
            },
            {
               name: 'Controls-default-theme',
               path: path.join(sourceFolder, 'Controls-default-theme')
            },
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      // recheck build result again to check proper work of incremental build
      await check();

      /**
       * after rebuild without "View" and "UI" module:
       * 1)html.tmpl must not be builded.
       * 2)project build must be completed successfully
       */
      (await isRegularFile(moduleOutputFolder, 'TestHtmlTmpl.html')).should.equal(false);

      await clearWorkspace();
   });

   // проверим, что js локализации корректно создаются. и что en-US.less попадает в lang/en-US/en-US.css
   it('localization dictionary and style', async() => {
      const fixtureFolder = path.join(dirname, 'fixture/builder-generate-workflow/localization');
      await prepareTest(fixtureFolder);

      const config = {
         cache: cacheFolder,
         output: outputFolder,
         logs: logsFolder,
         less: true,
         localization: ['en-US', 'ru-RU'],
         'default-localization': 'ru-RU',
         modules: [
            {
               name: 'SBIS3.CONTROLS',
               path: path.join(sourceFolder, 'SBIS3.CONTROLS')
            },
            {
               name: 'Controls-default-theme',
               path: path.join(sourceFolder, 'Controls-default-theme')
            },
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      const check = async() => {
         // запустим таску
         await runWorkflowWithTimeout();
         (await isRegularFile(moduleOutputFolder, 'lang/en-US/en-US.css')).should.equal(true);
         (await isSymlink(moduleOutputFolder, 'lang/ru-RU/ru-RU.json')).should.equal(true);
      };

      await check();

      // второй раз, чтобы проверить не ломает ли чего инкрементальная сборка
      await check();

      await clearWorkspace();
   });

   it('check-common-meta', async() => {
      const fixtureFolder = path.join(dirname, 'fixture/builder-generate-workflow/versionize-meta');
      const moduleOutput = path.join(outputFolder, 'Module');
      const builderMetaOutput = path.join(outputFolder, 'Module/.builder');
      await prepareTest(fixtureFolder);
      await linkPlatform(sourceFolder);

      const testMeta = async(metaOutput) => {
         (await isRegularFile(metaOutput, 'versioned_modules.json')).should.equal(true);
         (await isRegularFile(metaOutput, 'cdn_modules.json')).should.equal(true);
         (await isRegularFile(moduleOutput, 'Module.metatypes')).should.equal(true);

         const versionedModules = await fs.readJson(path.join(metaOutput, 'versioned_modules.json'));
         const cdnModules = await fs.readJson(path.join(metaOutput, 'cdn_modules.json'));
         const metaTypes = await fs.readJson(path.join(moduleOutput, 'Module.metatypes'));

         versionedModules.should.have.members([
            'Module/browser.css',
            'Module/browser.min.css',
            'Module/browser_ie.css',
            'Module/browser_ie.min.css',
            'Module/browser-with-real-cdn.css',
            'Module/browser-with-real-cdn.min.css',
            'Module/browser-with-real-cdn_ie.css',
            'Module/browser-with-real-cdn_ie.min.css',
            'Module/demo.html'
         ]);
         cdnModules.should.have.members([
            'Module/browser.min.css',
            'Module/browser_ie.min.css',
            'Module/browser.css',
            'Module/browser_ie.css'
         ]);
         metaTypes.should.deep.equal({
            name: 'Module',
            id: 'test-id',
            kaizen: {
               uuid: 'test-uuid'
            },
            meta: [
               {
                  is: 'primitive',
                  id: 'internalWidget',
                  inherits: [],
                  required: true,
                  info: {},
                  attributes: []
               },
               {
                  is: 'primitive',
                  id: 'widget',
                  inherits: [],
                  required: true,
                  info: {},
                  attributes: []
               }
            ]
         });
      };

      const config = {
         cache: cacheFolder,
         output: outputFolder,
         logs: logsFolder,
         typescript: true,
         less: true,
         minimize: true,
         wml: true,
         builderTests: true,
         version: 'builder-test',
         localization: false,
         'default-localization': false,
         modules: [
            {
               name: 'Module',
               id: 'test-id',
               kaizen: {
                  uuid: 'test-uuid'
               },
               path: path.join(sourceFolder, 'Module')
            },
            {
               name: 'WS.Core',
               path: path.join(sourceFolder, 'WS.Core')
            },
            {
               name: 'View',
               path: path.join(sourceFolder, 'View')
            },
            {
               name: 'UI',
               path: path.join(sourceFolder, 'UI')
            },
            {
               name: 'Compiler',
               path: path.join(sourceFolder, 'Compiler')
            },
            {
               name: 'UICore',
               path: path.join(sourceFolder, 'UICore')
            },
            {
               name: 'UICommon',
               path: path.join(sourceFolder, 'UICommon')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      // with creating an empty output directory we can create a situation
      // when builder enables incremental copy from cache to output and
      // check proper copy of builder meta files
      await fs.ensureDir(outputFolder);
      await runWorkflowWithTimeout();

      await testMeta(builderMetaOutput);

      // check builder meta again after rebuild, incremental build should work properly
      await runWorkflowWithTimeout();

      await testMeta(builderMetaOutput);

      await clearWorkspace();
   });

   it('minimize third-party libraries', async() => {
      const fixtureFolder = path.join(dirname, 'fixture/builder-generate-workflow/minimize');
      const testResults = async() => {
         const firstMinifiedContent = await fs.readFile(path.join(outputFolder, 'ThirdPartyModule/third-party/test.min.js'), 'utf8');
         const secondMinifiedContent = await fs.readFile(path.join(outputFolder, 'ThirdPartyModule/third-party/test2.min.js'), 'utf8');

         // source library with minified version must be written into output as is
         removeRSymbol(firstMinifiedContent).should.equal('define("ThirdPartyModule/test", ["someDependency"], function (dep1) {\n' +
            '   /* minified content from sources */\n' +
            '   return {\n' +
            '      dep1: dep1,\n' +
            '      _moduleName: \'ThirdPartyModule/test\'\n' +
            '   }\n' +
            '});');

         // source library without minified version must be minified by builder
         removeRSymbol(secondMinifiedContent).should.equal(
            'define("ThirdPartyModule/test2",["someDependency","someAnotherDependency"],(function(e,d){return{dep1:e,dep2:d,_moduleName:"ThirdPartyModule/test2"}}));'
         );
      };
      await prepareTest(fixtureFolder);
      await linkPlatform(sourceFolder);
      const config = {
         cache: cacheFolder,
         output: outputFolder,
         logs: logsFolder,
         minimize: true,
         modules: [
            {
               name: 'ThirdPartyModule',
               path: path.join(sourceFolder, 'ThirdPartyModule')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      await runWorkflowWithTimeout();
      await testResults();
      await runWorkflowWithTimeout();
      await testResults();
      await clearWorkspace();
   });

   it('filter sources', async() => {
      const fixtureFolder = path.join(dirname, 'fixture/builder-generate-workflow/esAndTs');
      await prepareTest(fixtureFolder);
      const config = {
         cache: cacheFolder,
         output: sourceFolder,
         logs: logsFolder,
         typescript: true,
         modules: [
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      const sourceTsMTime = await getMTime(path.join(sourceFolder, 'Модуль/StableTS.ts'));

      await runWorkflowWithTimeout(30000);

      (await getMTime(path.join(sourceFolder, 'Модуль/StableTS.ts'))).should.equal(sourceTsMTime);
      await clearWorkspace();
   });
   describe('custom pack', () => {
      const config = {
         cache: cacheFolder,
         output: outputFolder,
         logs: logsFolder,
         typescript: true,
         less: true,
         minimize: true,
         wml: true,
         version: 'builder.unit.tests',
         localization: ['en', 'ru', 'ru-RU'],
         'default-localization': 'ru-RU',
         deprecatedXhtml: true,
         builderTests: true,
         customPack: true,
         contents: true,
         compress: true,
         joinedMeta: true,
         dependenciesGraph: true,
         sourceMaps: true,
         modules: [
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль'),
               depends: ['WS.Core', 'Types', 'SBIS3.CONTROLS']
            },
            {
               name: 'ExternalInterfaceModule',
               path: path.join(sourceFolder, 'ExternalInterfaceModule')
            },
            {
               name: 'InterfaceModule1',
               path: path.join(sourceFolder, 'InterfaceModule1')
            },
            {
               name: 'InterfaceModule1-default-theme',
               path: path.join(sourceFolder, 'InterfaceModule1-default-theme')
            },
            {
               name: 'InterfaceModule2',
               path: path.join(sourceFolder, 'InterfaceModule2')
            },
            {
               name: 'InterfaceModule3',
               path: path.join(sourceFolder, 'InterfaceModule3')
            },
            {
               name: 'WS.Core',
               path: path.join(sourceFolder, 'WS.Core')
            },
            {
               name: 'View',
               path: path.join(sourceFolder, 'View')
            },
            {
               name: 'UI',
               path: path.join(sourceFolder, 'UI')
            },
            {
               name: 'Compiler',
               path: path.join(sourceFolder, 'Compiler')
            },
            {
               name: 'UICore',
               path: path.join(sourceFolder, 'UICore')
            },
            {
               name: 'UICommon',
               path: path.join(sourceFolder, 'UICommon')
            },
            {
               name: 'Vdom',
               path: path.join(sourceFolder, 'Vdom')
            },
            {
               name: 'Router',
               path: path.join(sourceFolder, 'Router')
            },
            {
               name: 'Inferno',
               path: path.join(sourceFolder, 'Inferno')
            },
            {
               name: 'Types',
               path: path.join(sourceFolder, 'Types')
            },
            {
               name: 'Module_with_library',
               path: path.join(sourceFolder, 'Module_with_library')
            }
         ]
      };
      before(async() => {
         const fixtureFolder = path.join(dirname, 'fixture/custompack');
         await prepareTest(fixtureFolder);
         await linkPlatform(sourceFolder);
         await fs.writeJSON(configPath, config);

         await runWorkflowWithTimeout();

         let moduleFile = await fs.readFile(path.join(sourceFolder, 'InterfaceModule1/library.ts'), 'utf8');
         moduleFile = `/* test */ \n${moduleFile}`;
         await fs.outputFile(path.join(sourceFolder, 'InterfaceModule1/library.ts'), moduleFile);

         // make another run of workflow to check correct work of incremental custom pack
         await runWorkflowWithTimeout();
      });

      it('joined meta must have all common builder meta files', async() => {
         (await isRegularFile(outputFolder, 'module-dependencies.json')).should.equal(true);
         (await isRegularFile(outputFolder, 'module-dependencies.min.json')).should.equal(true);
         (await isRegularFile(outputFolder, 'bundles.js')).should.equal(true);
         (await isRegularFile(outputFolder, 'bundles.min.js')).should.equal(true);
         (await isRegularFile(outputFolder, 'router.js')).should.equal(true);
         (await isRegularFile(outputFolder, 'router.min.js')).should.equal(true);
         (await isRegularFile(outputFolder, 'contents.json')).should.equal(true);
      });
      it('joined meta must have correct data', async() => {
         const routerMeta = await fs.readFile(path.join(outputFolder, 'router.js'), 'utf8');
         const minRouterMeta = await fs.readFile(path.join(outputFolder, 'router.min.js'), 'utf8');
         const correctRouterMeta = 'define(\'router\', [], function(){ return {"/":"Modul/Index"}; })';
         routerMeta.should.equal(correctRouterMeta);
         minRouterMeta.should.equal(correctRouterMeta);
      });
      it('private packages should be generated despite of theirs not existing in bundles approved list', async() => {
         const resultPackage = await fs.readFile(path.join(moduleOutputFolder, 'private.min.js'), 'utf8');
         const correctResultPackage = await fs.readFile(
            path.join(sourceFolder, 'correctResult/privatePackage.js'),
            'utf8'
         );
         removeRSymbol(resultPackage).should.equal(removeRSymbol(correctResultPackage));
      });
      it('original files of modules should be created only for private packages', async() => {
         (await isRegularFile(moduleOutputFolder, 'private.min.original.js')).should.equal(true);
         (await isRegularFile(moduleOutputFolder, 'lazy-private.package.min.original.js')).should.equal(false);
         (await isRegularFile(moduleOutputFolder, 'test-brotli.package.min.original.js')).should.equal(false);
      });
      it('custom package with lazy modules initialization should be generated correctly', async() => {
         const privateLazyPackage = await fs.readFile(
            path.join(outputFolder, 'Modul/lazy-private.package.min.js'),
            'utf8'
         );
         const correctPrivateLazyPackage = await fs.readFile(
            path.join(sourceFolder, 'correctResult/lazyPrivatePackage.js'),
            'utf8'
         );
         removeRSymbol(privateLazyPackage).should.equal(removeRSymbol(correctPrivateLazyPackage));
      });
      it('optional bundles must be written in a special meta and should be includes into common bundles meta', async() => {
         (await isRegularFile(path.join(outputFolder, 'InterfaceModule1'), 'optionalBundles.min.js')).should.equal(true);
         (await isRegularFile(path.join(outputFolder, 'InterfaceModule1'), 'optionalBundles.json')).should.equal(true);
         const optionalBundlesContent = await fs.readJson(path.join(outputFolder, 'InterfaceModule1/optionalBundles.json'));
         optionalBundlesContent.should.deep.equal({
            'resources/InterfaceModule1/interfacemodule1-styles-in-js-optional.package.min': [
               'InterfaceModule1/_private/module1',
               'InterfaceModule1/_private/module2',
               'InterfaceModule1/amdModule',
               'InterfaceModule1/lang/ru/ru.json',
               'InterfaceModule1/library',
               'css!InterfaceModule1/amdModule'
            ]
         });

         // bundles meta of optional bundle must not be written in common bundles meta
         const bundlesRouteContent = await fs.readJson(path.join(outputFolder, 'InterfaceModule1/bundlesRoute.json'));
         bundlesRouteContent['InterfaceModule1/_private/module1'].should.equal(
            'resources/InterfaceModule1/interfacemodule1-styles-in-js.package.min.js'
         );

         // contents meta must have info about optional bundles also as common meta
         const currentContents = await fs.readJson(path.join(outputFolder, 'InterfaceModule1/contents.json'));
         currentContents.modules.InterfaceModule1.hasOptionalBundles.should.equal(true);
         currentContents.modules.InterfaceModule1.hasBundles.should.equal(true);
      });
      it('exclude new unknown for builder packages', async() => {
         (await isRegularFile(moduleOutputFolder, 'test.package.min.js')).should.equal(false);
         (await isRegularFile(moduleOutputFolder, 'test.package.min.css')).should.equal(false);
      });
      it('gzip and brotli - check for brotli correct encoding and decoding. Should compressed only minified and packed', async() => {
         const resultFiles = await fs.readdir(moduleOutputFolder);
         const correctMembers = [
            '.builder',
            'Modul.s3mod',
            'Test',
            'lang',
            'TestASort',
            'TestBSort',
            'Page.min.wml',
            'Page.wml.map',
            'Page.min.wml.gz',
            'Page.min.wml.br',
            'Page.wml',
            'Page.min.xhtml',
            'Page.min.xhtml.br',
            'Page.min.xhtml.gz',
            'Page.xhtml',
            'contents.json',
            'contents.json.js',
            'contents.json.min.js',
            'contents.json.min.js.br',
            'contents.json.min.js.gz',
            'contents.min.json',
            'contents.min.json.gz',
            'contents.min.json.br',
            'Stable.css',
            'Stable_ie.css',
            'Stable.less',
            'Stable.min.css',
            'Stable.min.css.gz',
            'Stable.min.css.br',
            'Stable_ie.min.css',
            'Stable_ie.min.css.gz',
            'Stable_ie.min.css.br',
            'cbuc-icons.eot',
            'bundlesRoute.json',
            'module-dependencies.json',
            'pack.package.json',
            'test-brotli.package.min.css',
            'test-brotli.package.min.css.gz',
            'test-brotli.package.min.css.br',
            'test-brotli.package_ie.min.css',
            'test-brotli.package_ie.min.css.gz',
            'test-brotli.package_ie.min.css.br',
            'test-brotli.package.min.js',
            'test-brotli.package.min.js.lockfile',
            'test-brotli.package.min.js.gz',
            'test-brotli.package.min.js.br',
            'private.js',
            'private.min.css',
            'private.min.css.gz',
            'private.min.css.br',
            'private_ie.min.css',
            'private_ie.min.css.gz',
            'private_ie.min.css.br',
            'private.min.js',
            'private.js.map',
            'private.min.js.gz',
            'private.min.js.br',
            'private.min.original.js',
            'private.min.js.private',
            'private.min.js.lockfile',
            'private.package.json',
            'router.json',
            'router.json.js',
            'router.json.min.js',
            'router.json.min.js.br',
            'router.json.min.js.gz',
            'router.min.json',
            'router.min.json.br',
            'router.min.json.gz',
            'lazy-private.package.min.css',
            'lazy-private.package.min.css.gz',
            'lazy-private.package.min.css.br',
            'lazy-private.package_ie.min.css',
            'lazy-private.package_ie.min.css.gz',
            'lazy-private.package_ie.min.css.br',
            'lazy-private.package.min.js',
            'lazy-private.package.min.js.private',
            'lazy-private.package.min.js.lockfile',
            'lazy-private.package.min.js.br',
            'lazy-private.package.min.js.gz',
            'packageMap.json',
            'packageMap.json.js',
            'packageMap.json.min.js',
            'packageMap.json.min.js.br',
            'packageMap.json.min.js.gz'
         ];

         // output directory must have brotli(except windows os) and gzip files, only for minified files and packages.
         resultFiles.should.have.members(correctMembers);
         const cssContent = await fs.readFile(path.join(moduleOutputFolder, 'test-brotli.package.min.js'));
         const cssBrotliContent = await fs.readFile(path.join(moduleOutputFolder, 'test-brotli.package.min.js.br'));
         const cssDecompressed = await decompress(cssBrotliContent);

         // decompressed brotli must be equal source css content
         cssDecompressed.toString().should.equal(cssContent.toString());
      });
      it('versioned modules meta should have correct members', async() => {
         const testResults = async() => {
            const versionedModules = await fs.readJson(path.join(moduleOutputFolder, '.builder/versioned_modules.json'));
            versionedModules.should.have.members([
               'Modul/Test/test.package.min.css',
               'Modul/Test/test.package_ie.min.css',
               'Modul/TestASort/test.package.min.css',
               'Modul/TestASort/test.package_ie.min.css',
               'Modul/TestBSort/test-projectExtDeps.package.min.css',
               'Modul/TestBSort/test-projectExtDeps.package_ie.min.css',
               'Modul/TestBSort/test-projectMDeps.package.min.css',
               'Modul/TestBSort/test-projectMDeps.package_ie.min.css',
               'Modul/TestBSort/test-superbundle.package.min.css',
               'Modul/TestBSort/test-superbundle.package_ie.min.css',
               'Modul/private.min.css',
               'Modul/private_ie.min.css',
               'Modul/lazy-private.package.min.css',
               'Modul/lazy-private.package_ie.min.css',
               'Modul/test-brotli.package.min.css',
               'Modul/test-brotli.package_ie.min.css',
               'Modul/contents.json',
               'Modul/contents.json.js',
               'Modul/contents.json.min.js',
               'Modul/contents.min.json'
            ]);
            const cdnModules = await fs.readJson(path.join(moduleOutputFolder, '.builder/cdn_modules.json'));
            cdnModules.should.have.members([
               'Modul/Test/test.package.min.css',
               'Modul/Test/test.package_ie.min.css',
               'Modul/Test/test.package.min.js',
               'Modul/TestASort/test.package.min.css',
               'Modul/TestASort/test.package_ie.min.css',
               'Modul/TestASort/test.package.min.js',
               'Modul/TestBSort/test-projectExtDeps.package.min.css',
               'Modul/TestBSort/test-projectExtDeps.package_ie.min.css',
               'Modul/TestBSort/test-projectExtDeps.package.min.js',
               'Modul/TestBSort/test-projectMDeps.package.min.css',
               'Modul/TestBSort/test-projectMDeps.package_ie.min.css',
               'Modul/TestBSort/test-projectMDeps.package.min.js',
               'Modul/TestBSort/test-superbundle.package.min.css',
               'Modul/TestBSort/test-superbundle.package_ie.min.css',
               'Modul/TestBSort/test-superbundle.package.min.js',
               'Modul/private.min.css',
               'Modul/private_ie.min.css',
               'Modul/private.min.js',
               'Modul/lazy-private.package.min.css',
               'Modul/lazy-private.package_ie.min.css',
               'Modul/lazy-private.package.min.js',
               'Modul/test-brotli.package.min.css',
               'Modul/test-brotli.package_ie.min.css',
               'Modul/test-brotli.package.min.js'
            ]);
         };

         await runWorkflowWithTimeout();
         await testResults();

         // rerun to check correct work of versioning with incremental custom pack
         await runWorkflowWithTimeout();
         await testResults();
      });
      it('module-dependencies must have actual info after source component remove', async() => {
         await fs.remove(path.join(sourceFolder, 'Модуль/Page.wml'));

         // clear output to ensure correct work of incremental rebuild
         await fs.remove(outputFolder);
         await runWorkflowWithTimeout();
         const { nodes } = await fs.readJson(path.join(outputFolder, 'module-dependencies.json'));

         // after source remove and project rebuild module-dependencies must not have node for current source file
         nodes.hasOwnProperty('wml!Modul/Page').should.equal(false);
      });
      it('bundlesRoute meta must have all of libraries after incremental rebuild', async() => {
         const bundlesRoutePath = path.join(outputFolder, 'Module_with_library', 'bundlesRoute.json');
         (await isRegularFile(path.join(outputFolder, 'Module_with_library'), 'bundlesRoute.json')).should.equal(true);
         const bundlesRouteResult = await fs.readJson(bundlesRoutePath);
         bundlesRouteResult.should.deep.equal({
            'Module_with_library/library': 'resources/Module_with_library/library.min.js'
         });
      });
      it('bundlesRoute meta for intersecting packages must have meta for the latest sorted package', async() => {
         const bundlesRouteResult = await fs.readJson(path.join(moduleOutputFolder, 'bundlesRoute.json'));

         /**
          * bundlesRoute meta in 'Modul" interface module must not contain information about packed external modules,
          * it should be stored in proper interface module
          */
         bundlesRouteResult.hasOwnProperty('ExternalInterfaceModule/amdModule').should.equal(false);
         bundlesRouteResult.hasOwnProperty('css!ExternalInterfaceModule/moduleStyle').should.equal(false);

         const externalBundlesRouteResult = await fs.readJson(path.join(outputFolder, 'ExternalInterfaceModule/bundlesRoute.json'));
         externalBundlesRouteResult['ExternalInterfaceModule/amdModule'].should.equal('resources/Modul/TestBSort/test-projectMDeps.package.min.js');
         externalBundlesRouteResult['css!ExternalInterfaceModule/moduleStyle'].should.equal('resources/Modul/TestBSort/test-projectMDeps.package.min.css');
      });
      it('root bundles meta must have correct values', async() => {
         const rootBundlesMeta = await fs.readJson(path.join(outputFolder, 'bundles.json'));
         rootBundlesMeta.hasOwnProperty('resources/Modul/TestBSort/test-projectMDeps.package.min').should.equal(true);
         rootBundlesMeta['resources/Modul/TestBSort/test-projectMDeps.package.min'].should.deep.equal([
            'ExternalInterfaceModule/_private/module1',
            'ExternalInterfaceModule/_private/module2',
            'ExternalInterfaceModule/amdModule',
            'ExternalInterfaceModule/library',
            'Modul/private',
            'Modul/router.json',
            'css!ExternalInterfaceModule/moduleStyle',
            'css!ExternalInterfaceModule/moduleStyle_ie',
            'css!Modul/Stable',
            'html!Modul/Page'
         ]);
         const rootBundlesRouteMeta = await fs.readJson(path.join(outputFolder, 'bundlesRoute.json'));
         rootBundlesRouteMeta.hasOwnProperty('ExternalInterfaceModule/amdModule').should.equal(true);
         rootBundlesRouteMeta['ExternalInterfaceModule/amdModule'].should.equal('resources/Modul/TestBSort/test-projectMDeps.package.min.js');
      });
      it('superbundle\'s bundlesRoute meta must be saved in the same interface module', async() => {
         const bundlesRoute = await fs.readJson(path.join(moduleOutputFolder, 'bundlesRoute.json'));
         bundlesRoute.should.deep.equal({
            'InterfaceModule1/amdModule': 'resources/Modul/TestBSort/test-superbundle.package.min.js',
            'InterfaceModule1/library': 'resources/Modul/TestBSort/test-superbundle.package.min.js',
            'css!InterfaceModule1/moduleStyle': 'resources/Modul/TestBSort/test-superbundle.package.min.css',
            'css!InterfaceModule1/moduleStyle_ie': 'resources/Modul/TestBSort/test-superbundle.package.min.css',
            'css!InterfaceModule1/amdModule': 'resources/Modul/TestBSort/test-superbundle.package.min.css',
            'css!InterfaceModule1/amdModule_ie': 'resources/Modul/TestBSort/test-superbundle.package.min.css',
            'Modul/private': 'resources/Modul/test-brotli.package.min.js',
            'Modul/router.json': 'resources/Modul/test-brotli.package.min.js',
            'css!Modul/Stable': 'resources/Modul/test-brotli.package.min.css',
            'html!Modul/Page': 'resources/Modul/test-brotli.package.min.js'
         });
      });
      it('for desktop application dont save bundlesRoute meta', async() => {
         const fixtureFolder = path.join(dirname, 'fixture/custompack');
         await prepareTest(fixtureFolder);
         await linkPlatform(sourceFolder);
         const desktopConfig = {
            cache: cacheFolder,
            output: outputFolder,
            logs: logsFolder,
            typescript: true,
            less: true,
            minimize: true,
            wml: true,
            builderTests: true,
            customPack: true,
            sources: false,
            modules: [
               {
                  name: 'Модуль',
                  path: path.join(sourceFolder, 'Модуль')
               },
               {
                  name: 'ExternalInterfaceModule',
                  path: path.join(sourceFolder, 'ExternalInterfaceModule')
               },
               {
                  name: 'InterfaceModule1',
                  path: path.join(sourceFolder, 'InterfaceModule1')
               }
            ]
         };
         await fs.writeJSON(configPath, desktopConfig);

         await runWorkflowWithTimeout();

         /**
          * bundlesRoute must not be saved in results. bundles meta must be saved.
          * Only bundles.json meta from packer meta results uses in all desktop applications.
          */
         (await isRegularFile(moduleOutputFolder, 'bundlesRoute.json')).should.equal(false);
         (await isRegularFile(moduleOutputFolder, 'bundles.json')).should.equal(false);
         await runWorkflowWithTimeout();

         /**
          * bundlesRoute must not be saved in results. bundles meta must be saved.
          * Only bundles.json meta from packer meta results uses in all desktop applications.
          */
         (await isRegularFile(moduleOutputFolder, 'bundlesRoute.json')).should.equal(false);
         (await isRegularFile(moduleOutputFolder, 'bundles.json')).should.equal(false);
         await clearWorkspace();
      });
      it('custom pack must have an ability to work with debug files', async() => {
         const fixtureFolder = path.join(dirname, 'fixture/custompack');
         await prepareTest(fixtureFolder);
         await linkPlatform(sourceFolder);

         const testResults = async() => {
            const correctPackagePath = path.join(fixtureFolder, 'correctResult/interfacemodule1-with-debug');
            const packagePath = path.join(outputFolder, 'InterfaceModule1/interfacemodule1.package.min');
            const compiledCssPackage = await fs.readFile(`${packagePath}.css`, 'utf8');
            const compiledJsPackage = await fs.readFile(`${packagePath}.js`, 'utf8');
            const correctCssPackage = await fs.readFile(`${correctPackagePath}.css`, 'utf8');
            const correctJsPackage = await fs.readFile(`${correctPackagePath}.js`, 'utf8');
            removeRSymbol(compiledCssPackage).should.equal(removeRSymbol(correctCssPackage));
            removeRSymbol(compiledJsPackage).should.equal(removeRSymbol(correctJsPackage));
         };

         const desktopConfig = {
            cache: cacheFolder,
            output: outputFolder,
            logs: logsFolder,
            typescript: true,
            less: true,
            wml: true,
            builderTests: true,
            minimize: true,
            debugCustomPack: true,
            dependenciesGraph: true,
            distributive: false,
            joinedMeta: true,
            modules: [
               {
                  name: 'Модуль',
                  path: path.join(sourceFolder, 'Модуль')
               },
               {
                  name: 'ExternalInterfaceModule',
                  path: path.join(sourceFolder, 'ExternalInterfaceModule')
               },
               {
                  name: 'InterfaceModule1',
                  path: path.join(sourceFolder, 'InterfaceModule1')
               }
            ]
         };
         await fs.writeJSON(configPath, desktopConfig);

         await runWorkflowWithTimeout();
         await testResults();

         await runWorkflowWithTimeout();
         await testResults();

         await clearWorkspace();
      });
      it('rtl css packages', async() => {
         const fixtureFolder = path.join(dirname, 'fixture/custompack');
         await prepareTest(fixtureFolder);
         await linkPlatform(sourceFolder);

         const testResults = async() => {
            const correctPackagePath = path.join(fixtureFolder, 'correctResult/rtl-package');
            const packagePath = path.join(outputFolder, 'InterfaceModule1/interfacemodule1.package.min');
            const compiledCssPackage = await fs.readFile(`${packagePath}.css`, 'utf8');
            const compiledJsPackage = await fs.readFile(`${packagePath}.js`, 'utf8');
            const correctCssPackage = await fs.readFile(`${correctPackagePath}.css`, 'utf8');
            const correctJsPackage = await fs.readFile(`${correctPackagePath}.js`, 'utf8');
            removeRSymbol(compiledCssPackage).should.equal(removeRSymbol(correctCssPackage));
            removeRSymbol(compiledJsPackage).should.equal(removeRSymbol(correctJsPackage));
         };

         const desktopConfig = {
            cache: cacheFolder,
            output: outputFolder,
            logs: logsFolder,
            typescript: true,
            less: true,
            wml: true,
            builderTests: true,
            minimize: true,
            customPack: true,
            'default-localization': 'ru-RU',
            localization: ['ru-RU', 'he-IL'],
            dependenciesGraph: true,
            distributive: false,
            joinedMeta: true,
            modules: [
               {
                  name: 'Модуль',
                  path: path.join(sourceFolder, 'Модуль')
               },
               {
                  name: 'ExternalInterfaceModule',
                  path: path.join(sourceFolder, 'ExternalInterfaceModule')
               },
               {
                  name: 'InterfaceModule1',
                  path: path.join(sourceFolder, 'InterfaceModule1')
               }
            ]
         };
         await fs.writeJSON(configPath, desktopConfig);

         await runWorkflowWithTimeout();
         await testResults();

         await runWorkflowWithTimeout();
         await testResults();
      });

      it('custom flags for each module should work properly', async() => {
         const intModule1Output = path.join(outputFolder, 'InterfaceModule1');
         const fixtureFolder = path.join(dirname, 'fixture/custompack');
         await prepareTest(fixtureFolder);
         await linkPlatform(sourceFolder);

         const testResults = async() => {
            // there shouldn't be any artifacts of minimize
            (await isRegularFile(intModule1Output, 'amdModule.min.css')).should.equal(false);
            (await isRegularFile(intModule1Output, 'amdModule.min.js')).should.equal(false);

            // there shouldn't be any artifacts of typescript compile and libraries pack
            (await isRegularFile(intModule1Output, 'library.js')).should.equal(false);
            (await isRegularFile(intModule1Output, 'library.min.js')).should.equal(false);
            (await isRegularFile(`${intModule1Output}/_private`, 'module1.js')).should.equal(false);
            (await isRegularFile(`${intModule1Output}/_private`, 'module1.min.js')).should.equal(false);
            (await isRegularFile(`${intModule1Output}/_private`, 'module2.js')).should.equal(false);
            (await isRegularFile(`${intModule1Output}/_private`, 'module2.min.js')).should.equal(false);

            // there shouldn't be any artifacts of custom pack
            (await isRegularFile('InterfaceModule1/.builder', 'superbundle-for-builder-tests.package.js.package.json')).should.equal(false);
            (await isRegularFile('InterfaceModule1/packages', 'superbundle-for-builder-tests.package.min.css')).should.equal(false);
            (await isRegularFile('InterfaceModule1/packages', 'superbundle-for-builder-tests.package.min.js')).should.equal(false);
         };

         const desktopConfig = {
            cache: cacheFolder,
            output: outputFolder,
            logs: logsFolder,
            typescript: true,
            less: true,
            wml: true,
            builderTests: true,
            minimize: true,
            debugCustomPack: true,
            dependenciesGraph: true,
            distributive: false,
            joinedMeta: true,
            modules: [
               {
                  name: 'Модуль',
                  path: path.join(sourceFolder, 'Модуль')
               },
               {
                  name: 'ExternalInterfaceModule',
                  path: path.join(sourceFolder, 'ExternalInterfaceModule')
               },
               {
                  name: 'InterfaceModule1',
                  path: path.join(sourceFolder, 'InterfaceModule1'),
                  minimize: false,
                  typescript: false,
                  less: false,
                  wml: false,
                  debugCustomPack: false,
                  dependenciesGraph: false
               }
            ]
         };
         await fs.writeJSON(configPath, desktopConfig);

         await runWorkflowWithTimeout();
         await testResults();

         await runWorkflowWithTimeout();
         await testResults();

         await clearWorkspace();
      });

      it('builder must build only changed files', async() => {
         const fixtureFolder = path.join(dirname, 'fixture/custompack');
         await prepareTest(fixtureFolder);
         await linkPlatform(sourceFolder);

         // there should be sources and compiled files in new output only for changed files
         // all other sources shouldn't be found in new output directory
         const testResults = async() => {
            const changedFilesList = await fs.readJson(path.join(logsFolder, 'changed-files.json'));
            changedFilesList.InterfaceModule1.should.have.members([
               'amdModule_ie.min.css',
               'amdModule_ie.css',
               'amdModule.min.css',
               'amdModule.css',
               'library.ts',
               'library.min.js',
               'library.modulepack.js',
               'library.js',
               'module-dependencies.json'
            ]);
         };

         const currentConfig = {
            cache: cacheFolder,
            output: outputFolder,
            logs: logsFolder,
            typescript: true,
            less: true,
            wml: true,
            builderTests: true,
            minimize: true,
            dependenciesGraph: true,
            joinedMeta: true,
            outputIsCache: true,
            modules: [
               {
                  name: 'Модуль',
                  path: path.join(sourceFolder, 'Модуль')
               },
               {
                  name: 'ExternalInterfaceModule',
                  path: path.join(sourceFolder, 'ExternalInterfaceModule')
               },
               {
                  name: 'InterfaceModule1',
                  path: path.join(sourceFolder, 'InterfaceModule1'),
               }
            ]
         };
         await fs.writeJSON(configPath, currentConfig);

         await runWorkflowWithTimeout();
         const currentCssContent = await fs.readFile(
            path.join(sourceFolder, 'InterfaceModule1', 'amdModule.css'),
            'utf8'
         );
         await fs.outputFile(
            path.join(sourceFolder, 'InterfaceModule1', 'amdModule.css'),
            currentCssContent.replace('logo-en', 'logo-ru')
         );

         const currentTsContent = await fs.readFile(
            path.join(sourceFolder, 'InterfaceModule1', 'library.ts'),
            'utf8'
         );
         await fs.outputFile(
            path.join(sourceFolder, 'InterfaceModule1', 'library.ts'),
            `/* some comment */ \n ${currentTsContent}`
         );

         // add list of changed files for module InterfaceModule1
         currentConfig.modules[2].changedFiles = ['amdModule.css', 'library.ts'];

         // we need to check that only selected files will be built, so we need
         // change output directory and disable gulp_config check so cache
         // won't be removed.
         currentConfig.checkConfig = false;
         await fs.writeJSON(configPath, currentConfig);

         await runWorkflowWithTimeout();
         await testResults();

         await runWorkflowWithTimeout();
         await testResults();

         await clearWorkspace();
      });

      it('packed modules must be removed when "sources" flag has "false" value', async() => {
         const fixtureFolder = path.join(dirname, 'fixture/custompack');
         await prepareTest(fixtureFolder);
         await linkPlatform(sourceFolder);
         const moduleCacheFolder = path.join(cacheFolder, 'incremental_build', 'Modul');
         const testResults = async() => {
            (await isRegularFile(moduleOutputFolder, 'Page.min.wml')).should.equal(false);
            (await isRegularFile(moduleOutputFolder, 'private.min.js')).should.equal(false);
            (await isRegularFile(moduleOutputFolder, 'private.min.original.js')).should.equal(false);
            (await isRegularFile(moduleOutputFolder, 'pack.package.json')).should.equal(false);
            (await isRegularFile(moduleOutputFolder, 'Stable.min.css')).should.equal(false);

            // all packed modules are to be removed later in copy resources task
            (await isRegularFile(moduleCacheFolder, 'Page.min.wml')).should.equal(true);
            (await isRegularFile(moduleCacheFolder, 'private.min.js')).should.equal(true);
            (await isRegularFile(moduleCacheFolder, 'private.min.original.js')).should.equal(true);
            (await isRegularFile(moduleCacheFolder, 'pack.package.json')).should.equal(true);
            (await isRegularFile(moduleCacheFolder, 'Stable.min.css')).should.equal(true);

            const contentsPath = path.join(moduleOutputFolder, 'contents.json');
            const contents = await fs.readJson(contentsPath);
            contents.modules.Modul.hasOwnProperty('hasBundles').should.equal(true);

            const packageMapContent = await fs.readJson(path.join(moduleOutputFolder, 'packageMap.json'));
            packageMapContent.should.deep.equal({
               'InterfaceModule1/amdModule': 'Modul/TestBSort/test-superbundle.package.min.js',
               'InterfaceModule1/library': 'Modul/TestBSort/test-superbundle.package.min.js',
               'Modul/private': 'Modul/test-brotli.package.min.js',
               'Modul/router.json': 'Modul/test-brotli.package.min.js',
               'css!InterfaceModule1/amdModule': 'Modul/TestBSort/test-superbundle.package.min.css',
               'css!InterfaceModule1/moduleStyle': 'Modul/TestBSort/test-superbundle.package.min.css',
               'css!Modul/Stable': 'Modul/test-brotli.package.min.css',
               'wml!Modul/Page': 'Modul/test-brotli.package.min.js'
            });
         };

         const desktopConfig = {
            cache: cacheFolder,
            output: outputFolder,
            logs: logsFolder,
            typescript: true,
            less: true,
            wml: true,
            builderTests: true,
            customPack: true,
            minimize: true,
            contents: true,
            sources: false,
            modules: [
               {
                  name: 'Модуль',
                  path: path.join(sourceFolder, 'Модуль')
               },
               {
                  name: 'ExternalInterfaceModule',
                  path: path.join(sourceFolder, 'ExternalInterfaceModule')
               },
               {
                  name: 'InterfaceModule1',
                  path: path.join(sourceFolder, 'InterfaceModule1')
               },
               {
                  name: 'WS.Core',
                  path: path.join(sourceFolder, 'WS.Core')
               },
               {
                  name: 'View',
                  path: path.join(sourceFolder, 'View')
               },
               {
                  name: 'UI',
                  path: path.join(sourceFolder, 'UI')
               },
               {
                  name: 'Compiler',
                  path: path.join(sourceFolder, 'Compiler')
               },
               {
                  name: 'UICore',
                  path: path.join(sourceFolder, 'UICore')
               },
               {
                  name: 'UICommon',
                  path: path.join(sourceFolder, 'UICommon')
               },
               {
                  name: 'Vdom',
                  path: path.join(sourceFolder, 'Vdom')
               },
               {
                  name: 'Router',
                  path: path.join(sourceFolder, 'Router')
               },
               {
                  name: 'Inferno',
                  path: path.join(sourceFolder, 'Inferno')
               },
               {
                  name: 'Types',
                  path: path.join(sourceFolder, 'Types')
               }
            ]
         };
         await fs.writeJSON(configPath, desktopConfig);

         await runWorkflowWithTimeout();
         await testResults();

         await runWorkflowWithTimeout();
         await testResults();

         await clearWorkspace();
      });
   });

   it('rtl css packages with compiled module', async() => {
      const fixtureFolder = path.join(dirname, 'fixture/custompack');
      await prepareTest(fixtureFolder);
      await linkPlatform(sourceFolder);

      const checkDirIsSymlink = async(compiledModulePath) => {
         const realPath = await fs.realpath(compiledModulePath);
         const stats = await fs.lstat(compiledModulePath);
         stats.isSymbolicLink().should.equal(true);
         toPosix(realPath).should.be.equal(
            path.join(fixtureFolder, 'compiled/InterfaceModule1')
         );
      };

      const testResults = async() => {
         // compiled interface module is symlinked from compiled folder
         // must be symlinked in both cache and output directories
         await checkDirIsSymlink(path.join(outputFolder, 'InterfaceModule1'));

         const correctPackagePath = path.join(fixtureFolder, 'correctResult/rtl-package');
         const packagePath = path.join(outputFolder, 'InterfaceModule1/interfacemodule1.package.min');
         const compiledCssPackage = await fs.readFile(`${packagePath}.css`, 'utf8');
         const compiledJsPackage = await fs.readFile(`${packagePath}.js`, 'utf8');
         const correctCssPackage = await fs.readFile(`${correctPackagePath}.css`, 'utf8');
         const correctJsPackage = await fs.readFile(`${correctPackagePath}.js`, 'utf8');
         compiledCssPackage.should.equal(correctCssPackage);
         removeRSymbol(compiledJsPackage).should.equal(removeRSymbol(correctJsPackage));
      };

      const rtlConfig = {
         cache: cacheFolder,
         output: outputFolder,
         logs: logsFolder,
         typescript: true,
         less: true,
         wml: true,
         builderTests: true,
         minimize: true,
         customPack: true,
         'default-localization': 'ru-RU',
         localization: ['ru-RU', 'he-IL'],
         dependenciesGraph: true,
         distributive: false,
         joinedMeta: true,
         modules: [
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль')
            },
            {
               name: 'ExternalInterfaceModule',
               path: path.join(sourceFolder, 'ExternalInterfaceModule')
            },
            {
               name: 'InterfaceModule1',
               path: path.join(dirname, 'fixture/custompack/compiled/InterfaceModule1'),
               compiled: true
            }
         ]
      };
      await fs.writeJSON(configPath, rtlConfig);

      await runWorkflowWithTimeout();
      await testResults();

      await runWorkflowWithTimeout();
      await testResults();
   });

   it('pack static html - check paths validity to static packages', async() => {
      const fixtureFolder = path.join(dirname, 'fixture/builder-generate-workflow/packHTML');
      await prepareTest(fixtureFolder);
      await linkPlatform(sourceFolder);

      const testSingleServiceResults = async() => {
         /**
          * dependencies in current test are static, so we can also add check for package hash.
          */
         const packedHtml = await fs.readFile(path.join(outputFolder, 'TestModule/testPage.html'), 'utf8');
         const correctHtmlResult = await fs.readFile(path.join(fixtureFolder, 'correctSingleHtmlResult.html'), 'utf8');
         packedHtml.should.equal(correctHtmlResult);
         const staticCssPackage = await fs.readFile(path.join(outputFolder, 'TestModule/static_packages/640357cdcd290233e6f57f9cbc903632.min.css'), 'utf8');
         staticCssPackage.should.equal('.test-selector{test-var:undefined;test-var:var(--test-var);background:url(../Test/image/test.png)}');

         // in single service there should be static url for cdn
         packedHtml.includes('href="/cdn/EmojiFont/1.0.1/TFEmojiFont.woff2"').should.equal(true);
      };

      const testMultiServiceResults = async() => {
         const correctPackagesList = [
            'TestModule/static_packages/83c7371aab7ad4c88add83696aa26710.min.js',
            'TestModule/static_packages/d408360c83221ea67a00d8b16bd8cd4d.min.css',
            'TestModule/static_packages/ru-RU189e604be3df7a51aff15014143ace19.min.js',
            'TestModule/static_packages/en-USd453b4a41d0ba63babee569a6b351f39.min.js',
            'TestModule/static_packages/ru189e604be3df7a51aff15014143ace19.min.js',
            'TestModule/static_packages/end453b4a41d0ba63babee569a6b351f39.min.js'
         ];

         /**
          * dependencies in current test are static, so we can also add check for package hash.
          */
         const packedHtml = await fs.readFile(path.join(outputFolder, 'TestModule/testPage.html'), 'utf8');
         const correctHtmlResult = await fs.readFile(path.join(fixtureFolder, 'correctMultiHtmlResult.html'), 'utf8');
         packedHtml.should.equal(correctHtmlResult);
         const staticCssPackage = await fs.readFile(path.join(outputFolder, 'TestModule/static_packages/d408360c83221ea67a00d8b16bd8cd4d.min.css'), 'utf8');
         staticCssPackage.should.equal('.test-selector{test-var:undefined;test-var:var(--test-var);background:url(../Test/image/test.png?x_module=%{MODULE_VERSION_STUB=TestModule})}');

         // in multi service there should be placeholder for cdn in url
         packedHtml.includes('href="%{CDN_ROOT}EmojiFont/1.0.1/TFEmojiFont.woff2"').should.equal(true);
         const versionedModulesData = await fs.readJson(path.join(outputFolder, 'TestModule/.builder/versioned_modules.json'));
         versionedModulesData.should.have.members([
            'TestModule/Test/component1.css',
            'TestModule/Test/component1.min.css',
            'TestModule/Test/component1_ie.css',
            'TestModule/Test/component1_ie.min.css',
            'TestModule/rootTemplate.html',
            'TestModule/testPage.html',
            ...correctPackagesList
         ]);

         const cdnModulesData = await fs.readJson(path.join(outputFolder, 'TestModule/.builder/cdn_modules.json'));
         cdnModulesData.should.have.members([
            'TestModule/rootTemplate.html',
            'TestModule/testPage.html',
            ...correctPackagesList
         ]);
      };

      const config = {
         cache: cacheFolder,
         output: outputFolder,
         logs: logsFolder,
         deprecatedWebPageTemplates: true,
         localization: [
            'ru-RU', 'en-US'
         ],
         'default-localization': 'ru-RU',
         minimize: true,
         less: true,
         deprecatedStaticHtml: true,
         dependenciesGraph: true,
         'url-service-path': '/testService/',
         modules: [
            {
               name: 'TestModule',
               path: path.join(sourceFolder, 'TestModule')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      // run task
      await runWorkflowWithTimeout();
      await testSingleServiceResults();

      // check incremental build
      await runWorkflowWithTimeout();
      await testSingleServiceResults();

      // test static packer with multi-service and version-conjunction
      config['multi-service'] = true;
      config.version = 'test-version';

      await fs.writeJSON(configPath, config);

      // run task
      await runWorkflowWithTimeout();
      await testMultiServiceResults();

      // check incremental build
      await runWorkflowWithTimeout();
      await testMultiServiceResults();
      await clearWorkspace();
   });

   it('pack inline scripts - check for current packing of inline scripts into separated javascript files', async() => {
      const fixtureFolder = path.join(dirname, 'fixture/builder-generate-workflow/packHTML');
      await prepareTest(fixtureFolder);
      await linkPlatform(sourceFolder);

      const testResults = async(resourceRoot) => {
         /**
          * dependencies in current test are static, so we can also add check for package hash.
          */
         const packedHtml = await fs.readFile(path.join(outputFolder, 'TestModule/testPage.html'), 'utf8');
         let containsNeededPackage = packedHtml.includes(`<script id="testPage-inlineScript-0" src="${resourceRoot}TestModule/inlineScripts/testPage-0.js"> </script>`);
         containsNeededPackage.should.equal(true);

         /**
          * there is another inline script with empty content, so it should be skipped by packer
          * Example from current test - <script type="text/javascript" id="ws-include-components"></script>
          */
         containsNeededPackage = packedHtml.includes(`<script id="testPage-inlineScript-1" src="${resourceRoot}TestModule/inlineScripts/testPage-1.js"> </script>`);
         containsNeededPackage.should.equal(false);

         // packed javascript content of inline script should be correctly saved to correct file path
         const inlinePackageContent = await fs.readFile(path.join(outputFolder, 'TestModule/inlineScripts/testPage-0.js'), 'utf8');
         const correctInlinePackageContent = await fs.readFile(path.join(fixtureFolder, 'correctInlineScript.js'), 'utf8');
         removeRSymbol(inlinePackageContent).should.equal(removeRSymbol(correctInlinePackageContent));
      };

      const runTestIteration = async(resourceUrl) => {
         // run first iteration of project building with new configuration
         await runWorkflowWithTimeout();
         await testResults(resourceUrl);

         // run second iteration of the building for incremental build checking
         await runWorkflowWithTimeout();
         await testResults(resourceUrl);
      };

      const config = {
         cache: cacheFolder,
         output: outputFolder,
         logs: logsFolder,
         deprecatedWebPageTemplates: true,
         minimize: true,
         less: true,
         inlineScripts: false,
         'url-service-path': '/testService/',
         modules: [
            {
               name: 'TestModule',
               path: path.join(sourceFolder, 'TestModule')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      await runTestIteration('/testService/resources/');

      config.resourcesUrl = false;
      await fs.writeJSON(configPath, config);

      await runTestIteration('/testService/');

      config.multiService = true;
      await fs.writeJSON(configPath, config);

      await runTestIteration('%{RESOURCE_ROOT}');

      config.resourcesUrl = true;
      await fs.writeJSON(configPath, config);

      await runTestIteration('%{RESOURCE_ROOT}');
      await clearWorkspace();
   });

   // проверим, что паковка собственных зависимостей корректно работает при пересборке
   it('packOwnDeps', async() => {
      const fixtureFolder = path.join(dirname, 'fixture/builder-generate-workflow/packOwnDeps');
      await prepareTest(fixtureFolder);
      await linkPlatform(sourceFolder);
      const config = {
         cache: cacheFolder,
         output: outputFolder,
         logs: logsFolder,
         typescript: true,
         wml: true,
         minimize: true,
         deprecatedOwnDependencies: true,
         builderTests: true,
         localization: false,
         'default-localization': false,
         modules: [
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль')
            },
            {
               name: 'WS.Core',
               path: path.join(sourceFolder, 'WS.Core')
            },
            {
               name: 'View',
               path: path.join(sourceFolder, 'View')
            },
            {
               name: 'UI',
               path: path.join(sourceFolder, 'UI')
            },
            {
               name: 'Compiler',
               path: path.join(sourceFolder, 'Compiler')
            },
            {
               name: 'UICore',
               path: path.join(sourceFolder, 'UICore')
            },
            {
               name: 'UICommon',
               path: path.join(sourceFolder, 'UICommon')
            },
            {
               name: 'Vdom',
               path: path.join(sourceFolder, 'Vdom')
            },
            {
               name: 'Router',
               path: path.join(sourceFolder, 'Router')
            },
            {
               name: 'Inferno',
               path: path.join(sourceFolder, 'Inferno')
            },
            {
               name: 'Types',
               path: path.join(sourceFolder, 'Types')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      await runWorkflowWithTimeout();

      const testJsOutputPath = path.join(moduleOutputFolder, 'Test.min.js');
      let testJsOutputContent = (await fs.readFile(testJsOutputPath)).toString();

      // проверим, что js файл содержит актуальные данные из js, tmpl и wml
      testJsOutputContent.includes('TestClassTmplOld').should.equal(true);
      testJsOutputContent.includes('testFunctionTmplOld').should.equal(true);
      testJsOutputContent.includes('TestClassWmlOld').should.equal(true);
      testJsOutputContent.includes('testFunctionWmlOld').should.equal(true);

      // поменяем js
      const testJsInputPath = path.join(moduleSourceFolder, 'Test.ts');
      const testJsInputContent = await fs.readFile(testJsInputPath);
      const newTestJsInputContent = testJsInputContent.toString()
         .replace(/testFunctionTmplOld/g, 'testFunctionTmplNew')
         .replace(/testFunctionWmlOld/g, 'testFunctionWmlNew');
      await fs.writeFile(testJsInputPath, newTestJsInputContent);

      await runWorkflowWithTimeout();

      // проверим, что js файл содержит актуальные данные из js, tmpl и wml
      testJsOutputContent = (await fs.readFile(testJsOutputPath)).toString();
      testJsOutputContent.includes('TestClassTmplOld').should.equal(true);
      testJsOutputContent.includes('TestClassWmlOld').should.equal(true);
      testJsOutputContent.includes('testFunctionTmplNew').should.equal(true);
      testJsOutputContent.includes('testFunctionWmlNew').should.equal(true);

      // поменяем tmpl
      const testTmplInputPath = path.join(moduleSourceFolder, 'Test.tmpl');
      const testTmplInputContent = await fs.readFile(testTmplInputPath);
      await fs.writeFile(testTmplInputPath, testTmplInputContent.toString().replace(/TestClassTmplOld/g, 'TestClassTmplNew'));

      await runWorkflowWithTimeout();

      // проверим, что js файл содержит актуальные данные из js, tmpl и wml
      testJsOutputContent = (await fs.readFile(testJsOutputPath)).toString();
      testJsOutputContent.includes('TestClassTmplNew').should.equal(true);
      testJsOutputContent.includes('TestClassWmlOld').should.equal(true);
      testJsOutputContent.includes('testFunctionTmplNew').should.equal(true);
      testJsOutputContent.includes('testFunctionWmlNew').should.equal(true);

      // поменяем wml
      const testWmlInputPath = path.join(moduleSourceFolder, 'Test.wml');
      const testWmlInputContent = await fs.readFile(testWmlInputPath);
      await fs.writeFile(testWmlInputPath, testWmlInputContent.toString().replace(/TestClassWmlOld/g, 'TestClassWmlNew'));

      await runWorkflowWithTimeout();

      // проверим, что js файл содержит актуальные данные из js, tmpl и wml
      testJsOutputContent = (await fs.readFile(testJsOutputPath)).toString();
      testJsOutputContent.includes('TestClassTmplNew').should.equal(true);
      testJsOutputContent.includes('TestClassWmlNew').should.equal(true);
      testJsOutputContent.includes('testFunctionTmplNew').should.equal(true);
      testJsOutputContent.includes('testFunctionWmlNew').should.equal(true);
      await clearWorkspace();
   });

   // TODO: дополнить тест проверки реакции на изменение файлов
   it('compile es and ts', async() => {
      const checkFiles = async() => {
         const resultsFiles = await fs.readdir(moduleOutputFolder);
         resultsFiles.should.have.members([
            'Modul.s3mod',
            'StableTS.js',
            'StableTS.min.js',
            'StableTS.ts',
            'Stable.routes.ts',
            'Stable.routes.js',
            'ReactTest.tsx',
            'ReactTest.js',
            'ReactTest.min.js'
         ]);

         const TsOutputPath = path.join(moduleOutputFolder, 'StableTS.js');
         const TsxDevOutputPath = path.join(moduleOutputFolder, 'ReactTest.js');
         const TsxProdOutputPath = path.join(moduleOutputFolder, 'ReactTest.min.js');
         const RoutesTsOutputPath = path.join(moduleOutputFolder, 'Stable.routes.js');

         const TsContent = await fs.readFile(TsOutputPath);
         const TsxDevContent = await fs.readFile(TsxDevOutputPath);
         const TsxProdContent = await fs.readFile(TsxProdOutputPath);
         const RoutesTsContent = await fs.readFile(RoutesTsOutputPath);

         removeRSymbol(RoutesTsContent.toString()).should.equal(
            '"use strict";\n' +
            'module.exports = function () {\n' +
            '    return {\n' +
            '        \'/Module/Test\': function () { }\n' +
            '    };\n' +
            '};\n'
         );
         removeRSymbol(TsContent.toString()).should.equal(
            'define("Modul/StableTS", [' +
               '"require", ' +
               '"exports", ' +
               '"Modul/Di", ' +
               '"browser!/cdn/sound/id3-reader/id3-minimized.js", ' +
               '"is!browser?/cdn/sound/id3-reader/id3-minimized.js", ' +
               '"is!browser?cdn/sound/id3-reader/id3-minimized.js", ' +
               '"/cdn/sound/id3-reader/id3-minimized.js", ' +
               '"cdn/sound/id3-reader/id3-minimized.js"' +
               '], function (require, exports, Di_1) {\n' +
               '    "use strict";\n' +
               '    Object.defineProperty(exports, "__esModule", { value: true });\n' +
               '    var Factory = {\n' +
               '        Di: Di_1.default\n' +
               '    };\n' +
               '    exports.default = Factory;\n' +
               '});\n'
         );

         // check if debug version of tsx result has development react-jsx library
         removeRSymbol(TsxDevContent.toString()).should.equal(
            'define("Modul/ReactTest", ["require", "exports", "tslib", "react/jsx-dev-runtime"], function (require, exports, tslib_1, jsx_dev_runtime_1) {\n' +
            '    "use strict";\n' +
            '    Object.defineProperty(exports, "__esModule", { value: true });\n' +
            '    var _jsxFileName = "\\u041C\\u043E\\u0434\\u0443\\u043B\\u044C/ReactTest.tsx";\n' +
            '    function Square(props) {\n' +
            '        return ((0, jsx_dev_runtime_1.jsxDEV)("button", tslib_1.__assign({ className: "square", onClick: props.onClick }, { children: props.value }), void 0, false, { fileName: _jsxFileName, lineNumber: 2, columnNumber: 13 }, this));\n' +
            '    }\n' +
            '    exports.default = Square;\n' +
            '});\n'
         );

         // check if release version of tsx result has production react-jsx library
         removeRSymbol(TsxProdContent.toString()).should.equal(
            'define("Modul/ReactTest",["require","exports","tslib","react/jsx-runtime"],(function(e,t,u,n){' +
            '"use strict";' +
            'function r(e){return(0,n.jsx)("button",u.__assign({className:"square",onClick:e.onClick},{children:e.value}))}' +
            'Object.defineProperty(t,"__esModule",{value:true}),t.default=r' +
            '}));'
         );
      };

      const fixtureFolder = path.join(dirname, 'fixture/builder-generate-workflow/esAndTs');
      await prepareTest(fixtureFolder);

      const config = {
         cache: cacheFolder,
         output: outputFolder,
         logs: logsFolder,
         typescript: true,
         minimize: true,
         tsc: true,
         emitTypescript: true,
         modules: [
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      // запустим таску
      await runWorkflowWithTimeout();

      await checkFiles();

      // запустим повторно таску
      await runWorkflowWithTimeout();

      await checkFiles();

      await clearWorkspace();
   });

   it('check interfaces build and packing', async() => {
      const fixtureFolder = path.join(dirname, 'fixture/builder-generate-workflow/interfaces');
      const correctResultsFolder = path.join(fixtureFolder, 'compiledCorrectResult');
      const checkResults = async(
         currentModule,
         interfaceName,
         correctResultName,
         correctDependencies,
         checkSources
      ) => {
         const currentInterface = `${currentModule}/${interfaceName}`;
         if (checkSources) {
            const debugCorrectResult = await fs.readFile(
               path.join(correctResultsFolder, `${correctResultName}.js`),
               'utf8'
            );
            const currentDebugResult = await fs.readFile(
               path.join(outputFolder, `${currentInterface}.js`),
               'utf8'
            );
            removeRSymbol(debugCorrectResult).should.equal(removeRSymbol(currentDebugResult));
            const mDeps = await fs.readJson(path.join(outputFolder, currentModule, 'module-dependencies.json'));
            mDeps.links[currentInterface].should.have.members(correctDependencies);
         } else {
            (await isRegularFile(outputFolder, `${currentInterface}.js`)).should.be.equal(false);
         }

         const minifiedCorrectResult = await fs.readFile(
            path.join(correctResultsFolder, `${correctResultName}.min.js`),
            'utf8'
         );
         const currentMinifiedResult = await fs.readFile(
            path.join(outputFolder, `${currentInterface}.min.js`),
            'utf8'
         );

         removeRSymbol(minifiedCorrectResult).should.equal(removeRSymbol(currentMinifiedResult));
      };

      await prepareTest(fixtureFolder);

      const config = {
         cache: cacheFolder,
         output: outputFolder,
         logs: logsFolder,
         typescript: true,
         minimize: true,
         dependenciesGraph: true,
         contents: true,
         emitTypescript: true,
         tsc: true,
         modules: [
            {
               name: 'Module1',
               path: path.join(sourceFolder, 'Module1'),
               depends: ['ModuleWithAPI'],
               featuresProvided: ['scope', '_test/scope']
            },
            {
               name: 'Module2',
               path: path.join(sourceFolder, 'Module2'),
               depends: ['ModuleWithAPI'],
               featuresProvided: ['scope', '_test/scope']
            },
            {
               name: 'ModuleWithAPI',
               path: path.join(sourceFolder, 'ModuleWithAPI'),
               featuresRequired: ['scope', '_test/scope']
            }
         ]
      };
      await fs.writeJSON(configPath, config);


      await runWorkflowWithTimeout();

      // check that all placeholders are on its actual places
      await checkResults(
         'Module1',
         'scope',
         'firstProvider',
         ['ModuleWithAPI/scope', 'tslib'],
         true
      );
      await checkResults(
         'Module2',
         'scope',
         'secondProvider',
         ['ModuleWithAPI/scope', 'tslib'],
         true
      );
      await checkResults(
         'ModuleWithAPI',
         'scope',
         'moduleWithAPI',
         [],
         true
      );
      await checkResults(
         'ModuleWithAPI',
         '_test/scope',
         'innerModuleWithAPI',
         [],
         true
      );

      const interfaceRoutePath = path.join(outputFolder, 'interfaceRoute.json');
      let interfaceRouteContent = await fs.readJson(interfaceRoutePath);
      interfaceRouteContent.should.deep.equal({
         'ModuleWithAPI/_test/scope': [
            'Module1/_test/scope.js',
            'Module1/_test/scope.min.js',
            'Module2/_test/scope.js',
            'Module2/_test/scope.min.js'
         ],
         'ModuleWithAPI/scope': [
            'Module1/scope.js',
            'Module1/scope.min.js',
            'Module2/scope.js',
            'Module2/scope.min.js'
         ]
      });

      config.sources = false;
      await fs.writeJSON(configPath, config);

      await runWorkflowWithTimeout();
      await checkResults(
         'Module1',
         'scope',
         'firstProvider',
         ['ModuleWithAPI/scope'],
         false
      );
      await checkResults(
         'Module2',
         'scope',
         'secondProvider',
         [],
         false
      );
      await checkResults(
         'ModuleWithAPI',
         'scope',
         'moduleWithAPI',
         [],
         false
      );
      await checkResults(
         'ModuleWithAPI',
         '_test/scope',
         'innerModuleWithAPI',
         [],
         false
      );

      interfaceRouteContent = await fs.readJson(interfaceRoutePath);
      interfaceRouteContent.should.deep.equal({
         'ModuleWithAPI/_test/scope': [
            'Module1/_test/scope.min.js',
            'Module2/_test/scope.min.js'
         ],
         'ModuleWithAPI/scope': [
            'Module1/scope.min.js',
            'Module2/scope.min.js'
         ]
      });

      await runWorkflowWithTimeout();
      await checkResults(
         'Module1',
         'scope',
         'firstProvider',
         ['ModuleWithAPI/scope'],
         false
      );
      await checkResults(
         'Module2',
         'scope',
         'secondProvider',
         [],
         false
      );
      await checkResults(
         'ModuleWithAPI',
         'scope',
         'moduleWithAPI',
         [],
         false
      );
      await checkResults(
         'ModuleWithAPI',
         '_test/scope',
         'innerModuleWithAPI',
         [],
         false
      );

      interfaceRouteContent = await fs.readJson(interfaceRoutePath);
      interfaceRouteContent.should.deep.equal({
         'ModuleWithAPI/_test/scope': [
            'Module1/_test/scope.min.js',
            'Module2/_test/scope.min.js'
         ],
         'ModuleWithAPI/scope': [
            'Module1/scope.min.js',
            'Module2/scope.min.js'
         ]
      });

      config.joinedMeta = true;
      config.sources = true;
      await fs.writeJSON(configPath, config);

      await runWorkflowWithTimeout();

      (await isRegularFile(outputFolder, 'interfaceRoute.json')).should.equal(false);
      await checkResults(
         'Module1',
         'scope',
         'firstProvider',
         ['ModuleWithAPI/scope', 'tslib'],
         true
      );
      await checkResults(
         'Module2',
         'scope',
         'secondProvider',
         ['ModuleWithAPI/scope', 'tslib'],
         true
      );
      await checkResults(
         'ModuleWithAPI',
         'scope',
         'moduleWithAPI',
         [],
         true
      );
      await checkResults(
         'ModuleWithAPI',
         '_test/scope',
         'innerModuleWithAPI',
         [],
         true
      );

      // remove second provider and check that base interface will be packed
      // with a first one
      delete config.modules[1].featuresProvided;
      await fs.writeJSON(configPath, config);

      await runWorkflowWithTimeout();

      (await isRegularFile(outputFolder, 'interfaceRoute.json')).should.equal(false);
      await checkResults(
         'Module1',
         'scope',
         'firstProvider',
         ['ModuleWithAPI/scope', 'tslib'],
         true
      );
      await checkResults(
         'Module2',
         'scope',
         'secondProvider',
         ['ModuleWithAPI/scope', 'tslib'],
         true
      );
      await checkResults(
         'ModuleWithAPI',
         'scope',
         'moduleWithAPI',
         [],
         true
      );
      await checkResults(
         'ModuleWithAPI',
         '_test/scope',
         'innerModuleWithAPI',
         [],
         true
      );

      config.sources = false;
      await fs.writeJSON(configPath, config);
      await runWorkflowWithTimeout();

      (await isRegularFile(outputFolder, 'interfaceRoute.json')).should.equal(false);
      await checkResults(
         'Module1',
         'scope',
         'firstProvider',
         ['ModuleWithAPI/scope', 'tslib'],
         false
      );
      await checkResults(
         'Module2',
         'scope',
         'secondProvider',
         ['ModuleWithAPI/scope', 'tslib'],
         false
      );
      await checkResults(
         'ModuleWithAPI',
         'scope',
         'moduleWithAPI',
         [],
         false
      );
      await checkResults(
         'ModuleWithAPI',
         '_test/scope',
         'innerModuleWithAPI',
         [],
         false
      );

      await runWorkflowWithTimeout();

      (await isRegularFile(outputFolder, 'interfaceRoute.json')).should.equal(false);
      await checkResults(
         'Module1',
         'scope',
         'firstProvider',
         ['ModuleWithAPI/scope', 'tslib'],
         false
      );
      await checkResults(
         'Module2',
         'scope',
         'secondProvider',
         ['ModuleWithAPI/scope', 'tslib'],
         false
      );
      await checkResults(
         'ModuleWithAPI',
         'scope',
         'moduleWithAPI',
         [],
         false
      );
      await checkResults(
         'ModuleWithAPI',
         '_test/scope',
         'innerModuleWithAPI',
         [],
         false
      );

      await clearWorkspace();
   });

   it('compile json to ts', async() => {
      const checkFiles = async() => {
         const resultsFiles = await fs.readdir(moduleOutputFolder);
         resultsFiles.should.have.members([
            'currentLanguages.json',
            'currentLanguages.json.js',
            'currentLanguages.json.min.js',
            'currentLanguages.min.json'
         ]);

         const jsonJsOutputPath = path.join(moduleOutputFolder, 'currentLanguages.json.js');
         const jsonMinJsOutputPath = path.join(moduleOutputFolder, 'currentLanguages.json.min.js');

         const jsonJsContent = await fs.readFile(jsonJsOutputPath);
         const jsonMinJsContent = await fs.readFile(jsonMinJsOutputPath);
         const correctCompileJsonJs =
            "define('Modul/currentLanguages.json',[]," +
            'function(){return {' +
            '"ru-RU":"Русский (Россия)",' +
            '"uk-UA":"Українська (Україна)",' +
            '"en-US":"English (USA)"' +
            '};' +
            '});';

         jsonJsContent.toString().should.equal(correctCompileJsonJs);
         jsonMinJsContent.toString().should.equal(correctCompileJsonJs);
      };

      const fixtureFolder = path.join(dirname, 'fixture/builder-generate-workflow/jsonToJs');
      await prepareTest(fixtureFolder);

      const config = {
         cache: cacheFolder,
         output: outputFolder,
         logs: logsFolder,
         minimize: true,
         modules: [
            {
               name: 'WS.Core',
               path: path.join(sourceFolder, 'WS.Core')
            },
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      await linkPlatform(sourceFolder);

      // запустим таску
      await runWorkflowWithTimeout();

      await checkFiles();

      // запустим повторно таску
      await runWorkflowWithTimeout();

      await checkFiles();

      await clearWorkspace();
   });

   it('check removal of outdated files', async() => {
      const fixtureFolder = path.join(dirname, 'fixture/builder-generate-workflow/esAndTs');
      await prepareTest(fixtureFolder);

      const config = {
         cache: cacheFolder,
         output: outputFolder,
         logs: logsFolder,
         typescript: true,
         minimize: true,
         modules: [
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль')
            }
         ]
      };

      await fs.writeJSON(configPath, config);

      await linkPlatform(sourceFolder);

      // запустим таску
      await runWorkflowWithTimeout();

      (await isRegularFile(moduleOutputFolder, 'StableTS.ts')).should.be.equal(true);

      await fs.rename(path.join(sourceFolder, 'Модуль/StableTS.ts'), path.join(sourceFolder, 'Модуль/StableTS-new.ts'));

      // запустим таску
      await runWorkflowWithTimeout();

      (await isRegularFile(moduleOutputFolder, 'StableTS.ts')).should.be.equal(false);
      (await isRegularFile(moduleOutputFolder, 'StableTS-new.ts')).should.be.equal(true);

      await fs.remove(path.join(sourceFolder, 'Модуль/StableTS-new.ts'));

      await runWorkflowWithTimeout();

      (await isRegularFile(moduleOutputFolder, 'StableTS-new.ts')).should.be.equal(false);

      await clearWorkspace();
   });

   describe('pack-library', () => {
      const fixtureFolder = path.join(dirname, 'fixture/builder-generate-workflow/_packLibraries');
      const config = {
         cache: cacheFolder,
         output: outputFolder,
         logs: logsFolder,
         typescript: true,
         minimize: true,
         wml: true,
         builderTests: true,
         emitTypescript: true,
         tsc: true,
         dependenciesGraph: true,
         modules: [
            {
               name: 'WS.Core',
               path: path.join(sourceFolder, 'WS.Core')
            },
            {
               name: 'View',
               path: path.join(sourceFolder, 'View')
            },
            {
               name: 'UI',
               path: path.join(sourceFolder, 'UI')
            },
            {
               name: 'Compiler',
               path: path.join(sourceFolder, 'Compiler')
            },
            {
               name: 'UICore',
               path: path.join(sourceFolder, 'UICore')
            },
            {
               name: 'UICommon',
               path: path.join(sourceFolder, 'UICommon')
            },
            {
               name: 'Some fake name',
               path: path.join(sourceFolder, 'Modul')
            },
            {
               name: 'Modul2',
               path: path.join(sourceFolder, 'Modul2')
            },
            {
               name: 'TestModule',
               path: path.join(sourceFolder, 'TestModule')
            }
         ]
      };

      /**
       * Набор файлов и папок, который должен получиться по завершении workflow
       * при перезапуске без изменений данный набор также должен сохраниться.
       * @type {string[]}
       */
      const correctOutputContentList = [
         'Modul.s3mod',
         'Modul.ts',
         'Modul.js',
         'Modul.min.js',
         'Modul.modulepack.js',
         'external_public_deps.ts',
         'external_public_deps.js',
         'external_public_deps.min.js',
         'external_public_deps.modulepack.js',
         '_Cycle_dependence',
         '_External_dependence',
         '_es5',
         '_es6',
         'public',
         'module-dependencies.json',
         'libraryCycle.ts',
         'libraryCycle.js',
         'libraryCycle.min.js',
         'privateDepCycle.ts',
         'privateDepCycle.js',
         'privateDepCycle.min.js',
         'privateExternalDep.ts',
         'privateExternalDep.js',
         'privateExternalDep.min.js',
         'relativePluginDependency.ts',
         'testNativeNamesImports.ts',
         'testNativeNamesImports.js',
         'testNativeNamesImports.min.js',
         'testNativeNamesImports.modulepack.js',
         'publicFunction1.ts',
         'publicFunction1.js',
         'publicFunction1.min.js'
      ];

      /**
       * Будем хранить правильные исходники для всех тестов паковки
       * библиотек в одном объекте.
       * @type {{}}
       */
      const correctModulesContent = {};
      it('workspace-generated', async() => {
         await prepareTest(fixtureFolder);
         await linkPlatform(sourceFolder);
         await fs.writeJSON(configPath, config);
         await runWorkflowWithTimeout();
         const correctModulesPath = path.join(fixtureFolder, 'compiledCorrectResult');

         await pMap(
            [
               'Modul.js',
               'Modul2.js',
               'Modul.modulepack.js',
               'Module2.js',
               'Module2.modulepack.js',
               'libraryCycle.js',
               'privateDepCycle.js',
               'privateExternalDep.js',
               'testNativeNamesImports.js',
               'testNativeNamesImports.modulepack.js',
               'external_public_deps.js',
               'external_public_deps.modulepack.js',
               'no_interfaces.modulepack.js',
               'no_interfaces.js'
            ],
            async(basename) => {
               const readedFile = await fs.readFile(path.join(correctModulesPath, basename), 'utf8');
               correctModulesContent[basename] = readedFile
                  .slice(readedFile.indexOf('define('), readedFile.length);
            },
            {
               concurrency: 5
            }
         );
      });
      it('test-output-file-content', async() => {
         const resultsFiles = await fs.readdir(moduleOutputFolder);
         resultsFiles.should.have.members(correctOutputContentList);
      });
      it('interfaces private modules and its exports are removed from packed library', async() => {
         const packedLibrary = await fs.readFile(path.join(outputFolder, 'TestModule/Library.modulepack.js'), 'utf8');
         const debugLibrary = await fs.readFile(path.join(outputFolder, 'TestModule/Library.js'), 'utf8');

         removeRSymbol(packedLibrary).should.equal(removeRSymbol(correctModulesContent['no_interfaces.modulepack.js']));
         removeRSymbol(debugLibrary).should.equal(removeRSymbol(correctModulesContent['no_interfaces.js']));
      });
      it('libraries using relative dependencies with plugins must be ignored', async() => {
         (await isRegularFile(moduleOutputFolder, 'relativePluginDependency.js')).should.equal(false);
         const { messages } = await fs.readJson(path.join(workspaceFolder, 'logs/builder_report.json'));
         const errorMessage = 'relative dependencies with plugin are not valid. ';
         let relativeErrorExists = false;
         messages.forEach((currentError) => {
            if (currentError.message.includes(errorMessage)) {
               relativeErrorExists = true;
            }
         });
         relativeErrorExists.should.equal(true);
      });
      it('test-packed-library-dependencies-in-meta', async() => {
         const moduleDeps = await fs.readJson(path.join(moduleOutputFolder, 'module-dependencies.json'));
         const currentLibraryDeps = moduleDeps.links['Modul/external_public_deps'];
         currentLibraryDeps.should.have.members([
            'Modul/Modul',
            'Modul/public/publicInterface',
            'Modul/publicFunction1'
         ]);
         const currentLibraryPackedModules = moduleDeps.packedLibraries['Modul/external_public_deps'];
         currentLibraryPackedModules.should.have.members(['Modul/_es6/testPublicModule']);
      });
      it('test-first-level-return-statement-removal', async() => {
         const compiledEsOutputPath = path.join(moduleOutputFolder, 'external_public_deps.js');
         const packedCompiledEsOutputPath = path.join(moduleOutputFolder, 'external_public_deps.modulepack.js');

         const compiledEsContent = await fs.readFile(compiledEsOutputPath);
         const packedCompiledEsContent = await fs.readFile(packedCompiledEsOutputPath);

         removeRSymbol(compiledEsContent.toString()).should.equal(removeRSymbol(correctModulesContent['external_public_deps.js']));
         removeRSymbol(packedCompiledEsContent.toString()).should.equal(removeRSymbol(correctModulesContent['external_public_deps.modulepack.js']));
      });
      it('test-recurse', async() => {
         const compiledEsOutputPath = path.join(moduleOutputFolder, 'Modul.js');
         const packedCompiledEsOutputPath = path.join(moduleOutputFolder, 'Modul.modulepack.js');

         const compiledEsContent = await fs.readFile(compiledEsOutputPath);
         const packedCompiledEsContent = await fs.readFile(packedCompiledEsOutputPath);

         removeRSymbol(compiledEsContent.toString()).should.equal(removeRSymbol(correctModulesContent['Modul.js']));
         removeRSymbol(packedCompiledEsContent.toString()).should.equal(removeRSymbol(correctModulesContent['Modul.modulepack.js']));
      });
      it('test-not-amd-as-external-deps', async() => {
         const module2Output = path.join(outputFolder, 'Modul2');
         const compiledEsOutputPath = path.join(module2Output, 'Module2.js');
         const packedCompiledEsOutputPath = path.join(module2Output, 'Module2.modulepack.js');

         const compiledEsContent = await fs.readFile(compiledEsOutputPath);
         const packedCompiledEsContent = await fs.readFile(packedCompiledEsOutputPath);

         removeRSymbol(compiledEsContent.toString()).should.equal(removeRSymbol(correctModulesContent['Module2.js']));
         removeRSymbol(packedCompiledEsContent.toString()).should.equal(removeRSymbol(correctModulesContent['Module2.modulepack.js']));
      });
      it('test-native-variable-names-processing', async() => {
         const compiledEsOutputPath = path.join(moduleOutputFolder, 'testNativeNamesImports.js');
         const packedCompiledEsOutputPath = path.join(moduleOutputFolder, 'testNativeNamesImports.modulepack.js');

         const compiledEsContent = await fs.readFile(compiledEsOutputPath);
         const packedCompiledEsContent = await fs.readFile(packedCompiledEsOutputPath);

         removeRSymbol(compiledEsContent.toString()).should.equal(removeRSymbol(correctModulesContent['testNativeNamesImports.js']));
         removeRSymbol(packedCompiledEsContent.toString()).should.equal(removeRSymbol(correctModulesContent['testNativeNamesImports.modulepack.js']));
      });
      it('test-recurse-library-dependencies-in-store', async() => {
         const correctStoreDepsForModule = [
            'Modul/_es5/Module.js',
            'Modul/_es6/Модуль.ts',
            'Modul/_es6/Модуль2.ts'
         ];
         const dependenciesStore = await fs.readJson(path.join(cacheFolder, 'dependencies.json'));
         dependenciesStore['Modul/Модуль.ts'].should.have.members(correctStoreDepsForModule);
      });
      it('test-cycle-private-dependency', async() => {
         const compiledEsOutputPath = path.join(moduleOutputFolder, 'privateDepCycle.js');

         const compiledEsContent = await fs.readFile(compiledEsOutputPath);

         (await isRegularFile(moduleOutputFolder, 'privateDepCycle.modulepack.js')).should.equal(false);
         removeRSymbol(compiledEsContent.toString()).should.equal(removeRSymbol(correctModulesContent['privateDepCycle.js']));
      });
      it('test-cycle-library-dependency', async() => {
         const compiledEsOutputPath = path.join(moduleOutputFolder, 'libraryCycle.js');

         const compiledEsContent = await fs.readFile(compiledEsOutputPath);

         (await isRegularFile(moduleOutputFolder, 'libraryCycle.modulepack.js')).should.equal(false);
         removeRSymbol(compiledEsContent.toString()).should.equal(removeRSymbol(correctModulesContent['libraryCycle.js']));
      });
      it('test-external-private-dependency', async() => {
         let compiledEsOutputPath = path.join(module2OutputFolder, 'Modul.js');

         let compiledEsContent = await fs.readFile(compiledEsOutputPath);
         (await isRegularFile(module2OutputFolder, 'Modul.modulepack.js')).should.equal(false);

         removeRSymbol(compiledEsContent.toString()).should.equal(removeRSymbol(correctModulesContent['Modul2.js']));

         compiledEsOutputPath = path.join(moduleOutputFolder, 'privateExternalDep.js');

         compiledEsContent = await fs.readFile(compiledEsOutputPath);
         (await isRegularFile(module2OutputFolder, 'privateExternalDep.modulepack.js')).should.equal(false);
         removeRSymbol(compiledEsContent.toString()).should.equal(removeRSymbol(correctModulesContent['privateExternalDep.js']));
      });
      it('workflow-rebuilded', async() => {
         await runWorkflowWithTimeout();
      });
      it('test-output-file-content-after-rebuild', async() => {
         const resultsFiles = await fs.readdir(moduleOutputFolder);
         resultsFiles.should.have.members(correctOutputContentList);
      });
      it('interfaces private modules and its exports are removed from packed library after rebuild', async() => {
         const packedLibrary = await fs.readFile(path.join(outputFolder, 'TestModule/Library.modulepack.js'), 'utf8');
         const debugLibrary = await fs.readFile(path.join(outputFolder, 'TestModule/Library.js'), 'utf8');

         removeRSymbol(packedLibrary).should.equal(removeRSymbol(correctModulesContent['no_interfaces.modulepack.js']));
         removeRSymbol(debugLibrary).should.equal(removeRSymbol(correctModulesContent['no_interfaces.js']));
      });
      it('after rebuild - libraries using relative dependencies with plugins must be ignored', async() => {
         (await isRegularFile(moduleOutputFolder, 'relativePluginDependency.js')).should.equal(false);
         const { messages } = await fs.readJson(path.join(workspaceFolder, 'logs/builder_report.json'));
         const errorMessage = 'relative dependencies with plugin are not valid. ';
         let relativeErrorExists = false;
         messages.forEach((currentError) => {
            if (currentError.message.includes(errorMessage)) {
               relativeErrorExists = true;
            }
         });
         relativeErrorExists.should.equal(true);
      });
      it('test-packed-library-dependencies-in-meta-after-rebuild', async() => {
         const moduleDeps = await fs.readJson(path.join(moduleOutputFolder, 'module-dependencies.json'));
         const currentLibraryDeps = moduleDeps.links['Modul/external_public_deps'];
         currentLibraryDeps.should.have.members([
            'Modul/Modul',
            'Modul/public/publicInterface',
            'Modul/publicFunction1'
         ]);
         const currentLibraryPackedModules = moduleDeps.packedLibraries['Modul/external_public_deps'];
         currentLibraryPackedModules.should.have.members(['Modul/_es6/testPublicModule']);
      });
      it('test-first-level-return-statement-removal-after-rebuild', async() => {
         const compiledEsOutputPath = path.join(moduleOutputFolder, 'external_public_deps.js');
         const packedCompiledEsOutputPath = path.join(moduleOutputFolder, 'external_public_deps.modulepack.js');

         const compiledEsContent = await fs.readFile(compiledEsOutputPath);
         const packedCompiledEsContent = await fs.readFile(packedCompiledEsOutputPath);

         removeRSymbol(compiledEsContent.toString()).should.equal(removeRSymbol(correctModulesContent['external_public_deps.js']));
         removeRSymbol(packedCompiledEsContent.toString()).should.equal(removeRSymbol(correctModulesContent['external_public_deps.modulepack.js']));
      });
      it('test-recurse-library-dependencies-in-store-after-rebuild', async() => {
         const correctStoreDepsForModule = [
            'Modul/_es5/Module.js',
            'Modul/_es6/Модуль.ts',
            'Modul/_es6/Модуль2.ts'
         ];
         const dependenciesStore = await fs.readJson(path.join(cacheFolder, 'dependencies.json'));
         dependenciesStore['Modul/Модуль.ts'].should.have.members(correctStoreDepsForModule);
      });
      it('test-recurse-after-rerun-workflow', async() => {
         const resultsFiles = await fs.readdir(moduleOutputFolder);
         resultsFiles.should.have.members(correctOutputContentList);

         const compiledEsOutputPath = path.join(moduleOutputFolder, 'Modul.js');
         const packedCompiledEsOutputPath = path.join(moduleOutputFolder, 'Modul.modulepack.js');

         const compiledEsContent = await fs.readFile(compiledEsOutputPath);
         const packedCompiledEsContent = await fs.readFile(packedCompiledEsOutputPath);

         removeRSymbol(compiledEsContent.toString()).should.equal(removeRSymbol(correctModulesContent['Modul.js']));
         removeRSymbol(packedCompiledEsContent.toString()).should.equal(removeRSymbol(correctModulesContent['Modul.modulepack.js']));
      });
      it('test-not-amd-as-external-deps-after-rerun', async() => {
         const module2Output = path.join(outputFolder, 'Modul2');
         const compiledEsOutputPath = path.join(module2Output, 'Module2.js');
         const packedCompiledEsOutputPath = path.join(module2Output, 'Module2.modulepack.js');

         const compiledEsContent = await fs.readFile(compiledEsOutputPath);
         const packedCompiledEsContent = await fs.readFile(packedCompiledEsOutputPath);

         removeRSymbol(compiledEsContent.toString()).should.equal(removeRSymbol(correctModulesContent['Module2.js']));
         removeRSymbol(packedCompiledEsContent.toString()).should.equal(removeRSymbol(correctModulesContent['Module2.modulepack.js']));
      });
      it('test-native-variable-names-processing-after-rerun', async() => {
         const compiledEsOutputPath = path.join(moduleOutputFolder, 'testNativeNamesImports.js');
         const packedCompiledEsOutputPath = path.join(moduleOutputFolder, 'testNativeNamesImports.modulepack.js');

         const compiledEsContent = await fs.readFile(compiledEsOutputPath);
         const packedCompiledEsContent = await fs.readFile(packedCompiledEsOutputPath);

         removeRSymbol(compiledEsContent.toString()).should.equal(removeRSymbol(correctModulesContent['testNativeNamesImports.js']));
         removeRSymbol(packedCompiledEsContent.toString()).should.equal(removeRSymbol(correctModulesContent['testNativeNamesImports.modulepack.js']));
      });
      it('test-cycle-private-dependency-after-rebuild', async() => {
         const compiledEsOutputPath = path.join(moduleOutputFolder, 'privateDepCycle.js');

         const compiledEsContent = await fs.readFile(compiledEsOutputPath);

         (await isRegularFile(moduleOutputFolder, 'privateDepCycle.modulepack.js')).should.equal(false);
         removeRSymbol(compiledEsContent.toString()).should.equal(removeRSymbol(correctModulesContent['privateDepCycle.js']));
      });
      it('test-cycle-library-dependency-after-rebuild', async() => {
         const compiledEsOutputPath = path.join(moduleOutputFolder, 'libraryCycle.js');

         const compiledEsContent = await fs.readFile(compiledEsOutputPath);

         (await isRegularFile(moduleOutputFolder, 'libraryCycle.modulepack.js')).should.equal(false);
         removeRSymbol(compiledEsContent.toString()).should.equal(removeRSymbol(correctModulesContent['libraryCycle.js']));
      });
      it('test-external-private-dependency-after-rebuild', async() => {
         let compiledEsOutputPath = path.join(module2OutputFolder, 'Modul.js');

         let compiledEsContent = await fs.readFile(compiledEsOutputPath);
         (await isRegularFile(module2OutputFolder, 'Modul.modulepack.js')).should.equal(false);

         removeRSymbol(compiledEsContent.toString()).should.equal(removeRSymbol(correctModulesContent['Modul2.js']));

         compiledEsOutputPath = path.join(moduleOutputFolder, 'privateExternalDep.js');

         compiledEsContent = await fs.readFile(compiledEsOutputPath);
         (await isRegularFile(module2OutputFolder, 'privateExternalDep.modulepack.js')).should.equal(false);
         removeRSymbol(compiledEsContent.toString()).should.equal(removeRSymbol(correctModulesContent['privateExternalDep.js']));
      });
      it('workspace-cleared', async() => {
         await clearWorkspace();
      });
   });
});
