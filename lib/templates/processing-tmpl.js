'use strict';

const { toSafePosix, removeLeadingSlashes } = require('../platform/path');
const fs = require('fs-extra'),
   transliterate = require('../transliterate'),
   logger = require('../logger').logger(),
   promiseTimeout = require('../promise-with-timeout'),
   TemplatesBuilder = require('./templates-builder');

const templatesConfig = new TemplatesBuilder();

const resolverControls = function resolverControls(path) {
   return `tmpl!${path}`;
};

async function generateFunction(html, fullPath, componentsProperties) {
   if (html.indexOf('define') === 0) {
      throw new Error(`${fullPath} - не шаблон`);
   }

   const conf = { config: templatesConfig.ViewConfig, filename: fullPath };
   const templateRender = Object.create(templatesConfig.ViewBuilderTmpl),
      dependencies = [];

   templateRender.getComponents(html).forEach((dep) => {
      dependencies.push(dep);
   });

   // строю ast-дерево
   const traversedObj = await parseTmpl(html, fullPath, componentsProperties);
   const traversed = traversedObj.astResult;
   const topLevelComponentName = templateRender.getTopLevelComponentName(traversed);

   // строю функцию по ast-дереву
   const tmplFunc = templateRender.func(traversed, conf);
   return {
      dependencies,
      tmplFunc,
      topLevelComponentName
   };
}

// relativeFilePath должен начинаться с имени модуля
async function buildTmpl(text, relativeFilePath, componentsProperties, templateOptions) {
   templatesConfig.requireView();
   const { generateCodeForTranslations, useReact, moduleType } = templateOptions;
   const prettyRelativeFilePath = removeLeadingSlashes(toSafePosix(relativeFilePath));
   const compiler = new templatesConfig.Compiler();
   const config = {
      fileName: transliterate(prettyRelativeFilePath),
      fromBuilderTmpl: true,
      createResultDictionary: true,
      componentsProperties,
      generateCodeForTranslations,
      useReact,
      moduleType
   };
   try {
      return await compiler.compile(text, config);
   } catch (resultWithErrors) {
      /**
       * worker can't pass array of instances of Error through itself, so we need to stringify them
       * before transmit them out of the worker to main gulp process.
        */
      const normalizedErrorsList = resultWithErrors.errors.map(
         error => error.toString().replace(/(\r)?\n/g, ' ')
      ).join(';');
      throw new Error(normalizedErrorsList);
   }
}

async function buildHtmlTmpl(
   sourceText,
   fullPath,
   serviceConfig,
   relativeFilePath,
   componentsProperties,
   additionalInfo
) {
   templatesConfig.requireView();
   templatesConfig.setCommonRootInfo(serviceConfig);

   let cfg = {};
   const cfgPath = fullPath.replace(/\.html\.tmpl$/, '.html.cfg');
   if (await fs.pathExists(cfgPath)) {
      try {
         cfg = await fs.readJson(cfgPath);
      } catch (error) {
         logger.error({
            message: 'Ошибка при обработке конфигурации шаблона',
            error,
            filePath: cfgPath
         });
      }
   }

   const filePath = transliterate(relativeFilePath);
   const result = await generateFunction(sourceText, filePath, componentsProperties);
   const tmplFunc = result.tmplFunc.toString();

   if (relativeFilePath) {
      result.dependencies.push(`i18n!${filePath.split('/')[0]}`);
   }

   return templatesConfig.render({
      builder: tmplFunc,
      preInitScript: cfg.preInitScript || '',
      builderCompatible: cfg.compatible,
      theme: cfg.theme,
      dependencies: result.dependencies,
      buildFull: cfg.buildFull,
      extraInfo: {
         ...additionalInfo,
         topLevelComponentName: result.topLevelComponentName,
      }
   });
}

async function parseTmpl(tmplMarkup, currentPath, componentsProperties) {
   templatesConfig.requireView();
   const tmplParserPromise = new Promise((resolve, reject) => {
      templatesConfig.ViewBuilderTmpl.template(tmplMarkup, resolverControls, {
         config: templatesConfig.ViewConfig,
         filename: currentPath,
         fromBuilderTmpl: true,
         createResultDictionary: true,
         componentsProperties
      }).handle(
         (traversedObj) => {
            resolve(traversedObj);
         },
         (error) => {
            reject(error);
         }
      );
   });
   try {
      return await promiseTimeout.promiseWithTimeout(tmplParserPromise, 30000);
   } catch (err) {
      if (err instanceof promiseTimeout.TimeoutError) {
         const error = new promiseTimeout.TimeoutError(
            "Unhandled exception from 'View/Builder/Tmpl/traverse'! See logs in builder-build-resources!"
         );

         // TODO вернуть уровень error, когда будет однозначно понятно, из за какого шаблона свалилось по таймауту.
         logger.warning({
            error,
            filePath: currentPath,
            message: 'Critical ERROR!'
         });
         throw error;
      }
      throw err;
   }
}

function minifyTmpl(text) {
   const str = text.replace(/<![ \r\n\t]*(--([^-]|[\r\n]|-[^-])*--[ \r\n\t]*)>/g, '');
   return str.replace(/>\s{0}</g, '><');
}

module.exports = {
   buildTmpl,
   buildHtmlTmpl,
   parseTmpl,
   minifyTmpl
};
