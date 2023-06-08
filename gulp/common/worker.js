/**
 * Воркер для пула воркеров. Используется для сборки статики и сбора локализуемых фраз.
 * @author Kolbeshin F.A.
 */

/* eslint-disable no-console, global-require, no-inner-declarations */
'use strict';
const fs = require('fs-extra');
const { path } = require('../../lib/platform/path');
const { HTML_MINIFY_OPTIONS } = require('../../lib/builder-constants');
const htmlMinifier = require('html-minifier-terser');

try {
   // increase stack limit to 100 lines to get a better understanding of
   // an origin of an error, sometimes default 10 lines of stack of the error
   // isn't enough to understand what exactly has happened here
   Error.stackTraceLimit = 100;

   // логгер - прежде всего
   require('../../lib/logger').setWorkerLogger(process.env.logs);
   const logger = require('../../lib/logger').logger();

   // set information about current cloud to get correct messages (with info about cloud and responsible)
   // from worker to be added in a final builder_report
   logger.setBaseInfo(process.env.cloud, process.env.responsibleOfCloud);

   function initializeWSForWorker() {
      // ws должен быть вызван раньше чем первый global.requirejs
      const nodeWS = require('./node-ws');
      nodeWS.init(JSON.parse(process.env['required-modules']));
   }

   process.on('unhandledRejection', (reason, p) => {
      const error = {
         message: `worker's critical error. Unhandled Rejection at:\n ${p}\nreason:\n ${reason}`
      };
      console.log(error.message);

      /**
       * write critical initialize error into a single file. workerpool has a problem with emit
       * of this errors - all of this errors emits with message "Worker terminated unexpectedly"
       * without any message about what's exactly happened inside worker that cause process exit.
       */
      fs.outputJsonSync(path.join(process.env.logsPath, `worker/worker-critical-error-${process.pid}.json`), error);
      process.exit(1);
   });

   /**
    * require данного набора функционала требует инициализации ядра
    * для работы. Поэтому обьявление данных функций выполняем только
    * в случае инициализации ядра.
    */
   let processingTmpl, prepareXHTMLPrimitive,
      buildXhtmlPrimitive, collectWordsPrimitive;

   const
      workerPool = require('workerpool'),
      { compileEsAndTs } = require('../../lib/compile-es-and-ts'),
      { buildLess } = require('../../lib/less/build-less'),
      parseJsComponent = require('../../lib/parse-js-component'),
      runMinifyCss = require('../../lib/run-minify-css'),
      runMinifyXhtmlAndHtml = require('../../lib/run-minify-xhtml-and-html'),
      minifyJs = require('../../lib/run-minify-js'),
      { wrapWorkerFunction } = require('./helpers'),
      packLibrary = require('../../lib/pack/library-packer'),
      { brotli, gzip } = require('../../lib/helpers'),
      loadCompiledJs = require('../../lib/load-compiled-js');

   let componentsProperties;

   /**
    * Прочитать описание компонетов из json для локализации. Или взять прочитанное ранее.
    * @param {string} componentsPropertiesFilePath путь до json-файла описания компонентов
    * @returns {Promise<Object>}
    */
   async function readComponentsProperties(componentsPropertiesFilePath) {
      if (!componentsProperties) {
         if (await fs.pathExists(componentsPropertiesFilePath)) {
            componentsProperties = await fs.readJSON(componentsPropertiesFilePath);
         } else {
            componentsProperties = {};
         }
      }
      return componentsProperties;
   }

   /**
    * Компиляция tmpl файлов
    * @param {string} text содержимое файла
    * @param {string} relativeFilePath относительный путь до файла (начинается с имени модуля)
    * @param {string} componentsPropertiesFilePath путь до json-файла описания компонентов
    * @returns {Promise<{text, nodeName, dependencies}>}
    */
   async function buildTmpl(text, relativeFilePath, componentsPropertiesFilePath, generateCodeForTranslations) {
      const startTime = Date.now();
      if (!processingTmpl) {
         initializeWSForWorker();
         processingTmpl = require('../../lib/templates/processing-tmpl');
      }
      const result = await processingTmpl.buildTmpl(
         processingTmpl.minifyTmpl(text),
         relativeFilePath,
         await readComponentsProperties(componentsPropertiesFilePath),
         generateCodeForTranslations
      );
      return Object.assign(result, {
         timestamp: {
            start: startTime,
            finish: Date.now()
         }
      });
   }

   /**
    * Компиляция html.tmpl файлов
    * @param {string} sourceText содержимое файла
    * @param {string} fullPath полный путь до файла
    * @param {string} relativeFilePath относительный путь до файла (начинается с имени модуля)
    * @param {string} componentsPropertiesFilePath путь до json-файла описания компонентов
    * @param {boolean} isMultiService является ли проект мультисервисным
    * @param {string} servicesPath путь к текущему сервису
    * @returns {Promise<string>}
    */
   async function buildHtmlTmpl(
      sourceText,
      fullPath,
      serviceConfig,
      relativeFilePath,
      componentsPropertiesFilePath,
      additionalInfo
   ) {
      const startTime = Date.now();

      if (!processingTmpl) {
         initializeWSForWorker();
         processingTmpl = require('../../lib/templates/processing-tmpl');
      }

      const content = await processingTmpl.buildHtmlTmpl(
         sourceText,
         fullPath,
         serviceConfig,
         relativeFilePath,
         await readComponentsProperties(componentsPropertiesFilePath),
         additionalInfo
      );

      return {
         content,
         timestamp: {
            start: startTime,
            finish: Date.now()
         }
      };
   }

   /**
    * Для xhtml В XML формате расставляются скобки {[]} - аналог rk - для локализцемых фраз
    * (строки в разметке и переводимые опции).
    * @param {string} text содержимое файла
    * @param {string} componentsPropertiesFilePath путь до json-файла описания компонентов
    * @returns {Object}
    */
   async function prepareXHTML(text, componentsPropertiesFilePath) {
      const startTime = Date.now();
      if (!prepareXHTMLPrimitive) {
         initializeWSForWorker();
         prepareXHTMLPrimitive = require('../../lib/i18n/prepare-xhtml');
      }
      const newText = await prepareXHTMLPrimitive(text, await readComponentsProperties(componentsPropertiesFilePath));
      return {
         newText,
         timestamp: {
            start: startTime,
            finish: Date.now()
         }
      };
   }

   /**
    * Компиляция xhtml в js
    * @param {string} text содержимое файла
    * @param {string} relativeFilePath относительный путь до файла (начинается с имени модуля)
    * @returns {Promise<{nodeName, text}>}
    */
   async function buildXhtml(text, relativeFilePath, compilerOptions) {
      const startTime = Date.now();
      if (!buildXhtmlPrimitive) {
         initializeWSForWorker();
         buildXhtmlPrimitive = require('../../lib/templates/processing-xhtml').buildXhtml;
      }
      const content = await buildXhtmlPrimitive(await runMinifyXhtmlAndHtml(text), relativeFilePath, compilerOptions);
      return Object.assign(content, {
         timestamp: {
            start: startTime,
            finish: Date.now()
         }
      });
   }

   /**
    * Сбор локализуемых фрах для конкретного файла
    * @param {string} modulePath путь до модуля
    * @param {string} filePath путь до файла
    * @param {string} componentsPropertiesFilePath путь до json-файла описания компонентов
    * @returns {Promise<string[]>}
    */
   async function collectWords(modulePath, filePath, componentsPropertiesFilePath) {
      if (!componentsProperties) {
         componentsProperties = await fs.readJSON(componentsPropertiesFilePath);
      }
      if (!collectWordsPrimitive) {
         initializeWSForWorker();
         collectWordsPrimitive = require('../../lib/i18n/collect-words');
      }
      const text = await fs.readFile(filePath);
      return collectWordsPrimitive(modulePath, filePath, text.toString(), componentsProperties);
   }

   /**
    * Get compressed in gzip and brotli data for current text
    * @param {String} data - source text
    * @returns {Promise<{brotli: *, gzip: *}>}
    */
   async function compress(data) {
      const startTime = Date.now();

      // convert string to buffer. Brotli library can take only buffer as input.
      const dataBuffer = Buffer.from(data);
      const gzippedContent = await gzip(dataBuffer);
      const brotliContent = await brotli(dataBuffer);
      return {
         gzip: gzippedContent,
         brotli: brotliContent,
         timestamp: {
            start: startTime,
            finish: Date.now()
         }
      };
   }

   // Read compiled file if we already have a hash for source file in compiled directory
   function readCompiledFile(filePath, compiledHashFromCache, hash) {
      if (compiledHashFromCache && hash === compiledHashFromCache) {
         return fs.readFile(filePath, 'utf8');
      }
      return '';
   }

   function metaTsToJson(filePath) {
      if (!global.requirejs) {
         initializeWSForWorker();
      }
      const result = global.requirejs(filePath);

      if (result.default && typeof result.default.toJSON === 'function') {
         return result.default.toJSON();
      }

      if (typeof result.toJSON === 'function') {
         return result.toJSON();
      }

      return null;
   }

   async function doAsyncFs(operation, from, to, logOperation) {
      await fs[operation](from, to);
      if (logOperation) {
         logger.info(`${operation} completed from "${to}" into "${to}"`);
      }
   }

   function minifyHtml(text) {
      return htmlMinifier.minify(text, HTML_MINIFY_OPTIONS);
   }

   workerPool.worker({
      parseJsComponent: wrapWorkerFunction(parseJsComponent),
      buildLess: wrapWorkerFunction(buildLess),
      compileEsAndTs: wrapWorkerFunction(compileEsAndTs),
      buildTmpl: wrapWorkerFunction(buildTmpl),
      readCompiledFile: wrapWorkerFunction(readCompiledFile),
      buildHtmlTmpl: wrapWorkerFunction(buildHtmlTmpl),
      prepareXHTML: wrapWorkerFunction(prepareXHTML),
      buildXhtml: wrapWorkerFunction(buildXhtml),
      minifyCss: wrapWorkerFunction(runMinifyCss),
      minifyJs: wrapWorkerFunction(minifyJs),
      compress: wrapWorkerFunction(compress),
      collectWords: wrapWorkerFunction(collectWords),
      packLibrary: wrapWorkerFunction(packLibrary),
      loadCompiledJs: wrapWorkerFunction(loadCompiledJs),
      metaTsToJson: wrapWorkerFunction(metaTsToJson),
      doAsyncFs: wrapWorkerFunction(doAsyncFs),
      minifyHtml: wrapWorkerFunction(minifyHtml)
   });
} catch (workerInitError) {
   const error = { message: `Worker initialize error: ${workerInitError.message} Stack: ${workerInitError.stack}` };
   console.log(error.message);

   /**
    * write critical initialize error into a single file. workerpool has a problem with emit
    * of this errors - all of this errors emits with message "Worker terminated unexpectedly"
    * without any message about what's exactly happened inside worker that cause process exit.
    */
   fs.outputJson(path.join(process.env.logsPath, `worker/worker-initialize-error-${process.pid}.json`), error);
}
