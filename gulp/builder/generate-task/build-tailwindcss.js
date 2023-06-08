/**
 * @author Krylov M.A.
 */

'use strict';

const gulp = require('gulp');
const fs = require('fs-extra');

const util = require('util');
const exec = util.promisify(require('child_process').exec);

const { path } = require('../../../lib/platform/path');
const logger = require('../../../lib/logger').logger();

const COLLECT_CONTENT_FROM_DEPENDS = false;
const FILE_PATTERN = '**/*.{ts,tsx,wml,tmpl,html}';
const CONTAINER_QUERIES_PATH = path.normalize(require.resolve('@tailwindcss/container-queries'));
const TAILWINDCSS_CLI_PATH = path.join(
   require.resolve('tailwindcss'),
   '../../lib/cli.js'
);

const toTailwindConfig = (baseConfigPath, content) => (`'use strict';

const defaultParameters = require(${JSON.stringify(baseConfigPath)});

module.exports = {
   ...defaultParameters,
   content: ${JSON.stringify(content)},
   plugins: [
      require(${JSON.stringify(CONTAINER_QUERIES_PATH)}),
   ]
};
`);

function skipBuildTailwindCss(done) {
   done();
}

function compilePattern(moduleInfo) {
   return path.join(moduleInfo.path, FILE_PATTERN);
}

function getContentModulesFromDepends(taskParameters) {
   const dependsFromTailwind = moduleInfo => moduleInfo.depends.includes('Tailwind');

   return taskParameters.config.modules
      .filter(dependsFromTailwind)
      .map(compilePattern);
}

function getContentModules(taskParameters) {
   if (COLLECT_CONTENT_FROM_DEPENDS) {
      return getContentModulesFromDepends(taskParameters);
   }

   const isContentModule = moduleInfo => !(
      moduleInfo.name === 'Tailwind' ||
      moduleInfo.name.endsWith('-theme') ||
      moduleInfo.name.endsWith('-icons')
   );

   return taskParameters.config.modules
      .filter(isContentModule)
      .map(compilePattern);
}

function generateTaskForBuild(taskParameters) {
   return async function buildTailwindCss() {
      const tailwindModule = taskParameters.config.modules.find(moduleInfo => moduleInfo.name === 'Tailwind');
      if (!tailwindModule) {
         return;
      }

      try {
         const contentPathPatterns = getContentModules(taskParameters);
         const baseConfigPath = path.join(tailwindModule.path, 'tailwind.config.js');
         const configSourceText = toTailwindConfig(baseConfigPath, contentPathPatterns);

         const configurationFilePath = path.join(
            taskParameters.config.cachePath,
            'tailwind.config.js'
         );
         const outputFilePath = path.join(
            taskParameters.config.cachePath,
            'tailwind.css'
         );

         await fs.outputFile(configurationFilePath, configSourceText);
         await exec(`node "${TAILWINDCSS_CLI_PATH}" -c "${configurationFilePath}" -o "${outputFilePath}"`);

         tailwindModule.tailwindCssContents = await fs.readFile(outputFilePath, 'utf8');
      } catch (error) {
         // TODO: по задаче https://online.sbis.ru/opendoc.html?guid=3885811d-18b6-4c96-b3b4-0471dcecc824&client=3
         //    после обсуждения прийти к единому мнению по Tailwind -- либо использовать статические ресурсы, либо
         //    генерировать помодульно.
         logger.debug({
            message: `Error building Tailwind CSS: ${error.message}. Use static css file`,
            moduleInfo: tailwindModule,
            error
         });
      }
   };
}

function generateTaskForBuildTailwindCss(taskParameters) {
   if (!taskParameters.config.buildTailwindCss) {
      return skipBuildTailwindCss;
   }

   const buildTailwindCss = taskParameters.metrics.createTimer('build tailwind.css');

   return gulp.series(
      buildTailwindCss.start(),
      generateTaskForBuild(taskParameters),
      buildTailwindCss.finish()
   );
}

module.exports = generateTaskForBuildTailwindCss;
