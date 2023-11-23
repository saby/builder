/* eslint-disable no-await-in-loop */
/**
 * Generate task for build icons fonts
 * @author Kolbeshin F.A.
 */

'use strict';

const { path } = require('../../../lib/platform/path');
const gulp = require('gulp');
const svgtofont = require('svgtofont');
const handlePipeException = require('../../common/plugins/handle-pipe-exception');
const toPosixVinyl = require('../../common/plugins/to-posix-vinyl');
const analizeIconsPlugin = require('../plugins/analize-icons');
const logger = require('../../../lib/logger').logger();
const helpers = require('../../../lib/helpers');
const fs = require('fs-extra');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const { getHeapSizeCommand } = require('../../../lib/helpers');
const INCLUDE_EXTENSIONS = new Set([
   '.html',
   '.eot',
   '.woff',
   '.woff2',
   '.css'
]);

/**
 * Moves common font artifacts to selected directory
 * @param{String} fontName current font name
 * @param{String} from directory to move from
 * @param{String} to directory to move to
 * @returns {Promise<void>}
 */
async function moveCommonFontArtifacts(fontName, from, to) {
   const promises = [];
   const directoryList = await fs.readdir(from);
   directoryList.forEach((currentFile) => {
      const extension = path.extname(currentFile);
      const fileName = path.basename(currentFile, extension);
      if (fileName === fontName && INCLUDE_EXTENSIONS.has(extension)) {
         promises.push(fs.move(
            path.join(from, currentFile),
            path.join(to, currentFile),
            { overwrite: true }
         ));
      }
   });
   await Promise.all(promises);
}

async function generateFontByOutput(moduleOutput, currentFont, fontsToGenerate, moduleInfo, region) {
   const fontOutput = `${moduleOutput}/temp-${currentFont}`;
   const configOutput = `${moduleOutput}/temp-${currentFont}-config`;
   try {
      logger.debug(`Generating font for "${moduleOutput}/${currentFont}" svg files`);
      const svgOptions = {
         src: `${moduleOutput}/${currentFont}`,
         dist: fontOutput,
         startUnicode: 0xea01,
         useNameAsUnicode: true,
         fontName: currentFont,
         website: {
            logo: `${currentFont} font`,
            title: `Generated font for svg files in "${currentFont}" folder ${region ? ` for ${region} region` : ''}`
         }
      };

      // svgtofont вычитывает опции автоматом из файла .svgtofontrc, который
      // расположен в cwd, из под которого запускаем соответствующую cli-команду
      await fs.outputFile(path.join(configOutput, '.svgtofontrc'), JSON.stringify(svgOptions, null, 3));
      const processOptions = {
         maxBuffer: 1024 * 500,
         cwd: configOutput
      };

      if (!await fs.pathExists(fontOutput)) {
         await fs.mkdir(fontOutput);
      }

      // придётся вызывать svgtofont генератор через отдельный child_process, поскольку классический
      // запуск через async/await не отлавливает ошибки внутри этого генератора. Классический пример
      // вызов setTimeout внутри генератора приведёт к неотлавливаемой ошибке, можно положить весь
      // только из за одной кривой иконки. Вызов через отдельный child_process позволит отловить
      // любые ошибки, поскольку мы отлавливаем падение самого процесса.
      // Но вызов компилятора через cli не генерирует демо-примеры, html страницы и css стили шрифтов.
      // поэтому мы используем вызов через exec для отлова ошибок и дальнейший вызов через await для
      // генерации полного состава шрифтов и всех демо примеров. На текущий момент другого решения нет,
      // данная проблема может быть исправлена в новых версиях библиотеки svgtofont, но обновить её не
      // получится, пока глобально у всех не будет установлен Node.JS 18.x.x(элементарно npm i не выполнить
      // пока не будет установлена новая нода)
      const relativeSource = path.relative(moduleOutput, `${moduleOutput}/${currentFont}`);
      const svgtofontFlags = `--sources ../${relativeSource} --output ../temp-${currentFont}`;
      const heapSizeCommand = getHeapSizeCommand();
      try {
         await exec(
            `${heapSizeCommand} && node ${require.resolve('svgtofont/lib/cli')} ${svgtofontFlags}`,
            processOptions
         );
      } catch (error) {
         // пока выводим info, чтобы оценить масштаб бедствия. После можно выделить уровень WARNING и
         // выписать ответственным задачи
         logger.info({
            message: 'Error generating font',
            error,
            moduleInfo
         });
         return;
      }

      await svgtofont(svgOptions);

      // we can't specify specific name for demo html page in generator options
      // so rename it manually after font generate
      if (await fs.pathExists(path.join(fontOutput, 'index.html'))) {
         await fs.rename(
            path.join(fontOutput, 'index.html'),
            path.join(fontOutput, `${currentFont}.html`)
         );
      }

      // we can't specify list of artifacts to generate, so filter them and remove
      // useless artifacts(e.g. symbol.html, less files, scss file, etc.)
      await moveCommonFontArtifacts(currentFont, fontOutput, moduleOutput);
   } catch (error) {
      logger.warning({
         message: 'Error generating font',
         error,
         moduleInfo
      });
   }
   await fs.remove(fontOutput);
   await fs.remove(configOutput);
}

function generateTaskForBuildFont(taskParameters, moduleInfo, fontsToGenerate) {
   return async function buildIconsFont() {
      for (const currentFont of Object.keys(fontsToGenerate)) {
         await generateFontByOutput(
            moduleInfo.output,
            currentFont,
            fontsToGenerate,
            moduleInfo
         );

         // если есть региональный шрифт, его также необходимо сгенерировать.
         if (fontsToGenerate[currentFont].region) {
            const { region } = fontsToGenerate[currentFont];
            await generateFontByOutput(
               moduleInfo.regionOutput[region],
               currentFont,
               fontsToGenerate,
               moduleInfo,
               region
            );
         }
      }
   };
}

function generateTaskForAnalizeIcons(taskParameters, moduleInfo, fontsToGenerate) {
   const moduleOutput = path.join(
      taskParameters.config.rawConfig.output,
      path.basename(moduleInfo.output),
      '**/*.svg'
   );

   return function analizeIcons() {
      return gulp
         .src(moduleOutput, { dot: false, nodir: true })
         .pipe(handlePipeException('analizeIcons', taskParameters, moduleInfo))
         .pipe(toPosixVinyl())
         .pipe(analizeIconsPlugin(taskParameters, moduleInfo, fontsToGenerate))
         .pipe(gulp.dest(moduleOutput));
   };
}

function generateTaskForSaveContents(taskParameters, moduleInfo) {
   const hasLocalization = taskParameters.config.localizations.length > 0;
   if (!hasLocalization || !taskParameters.config.contents) {
      return function skipSaveContentsForFonts(done) {
         done();
      };
   }
   return async function saveContentsForFonts() {
      if (taskParameters.config.commonContents) {
         helpers.joinContents(taskParameters.config.commonContents, moduleInfo.contents);
      }
      const contentsPath = path.join(moduleInfo.output, 'contents.json');
      const sortedContents = JSON.stringify(helpers.sortObject(moduleInfo.contents));
      const contentsJsContent = helpers.generateContentsContent(
         moduleInfo.outputName,
         sortedContents,
         taskParameters.config.generateUMD
      );
      await fs.outputFile(contentsPath, sortedContents);
      await fs.outputFile(`${contentsPath}.js`, contentsJsContent);
      if (taskParameters.config.isReleaseMode) {
         await fs.outputFile(`${contentsPath}.min.js`, contentsJsContent);
      }
   };
}

function skipBuildFonts(done) {
   done();
}

function generateTaskForBuildFonts(taskParameters) {
   if (taskParameters.config.disableFontsGenerate) {
      return skipBuildFonts;
   }
   const tasks = [];

   for (const moduleInfo of taskParameters.config.modules) {
      if (moduleInfo.icons) {
         const fontsToGenerate = {};
         tasks.push(
            gulp.series(
               generateTaskForAnalizeIcons(taskParameters, moduleInfo, fontsToGenerate),
               generateTaskForBuildFont(taskParameters, moduleInfo, fontsToGenerate),
               generateTaskForSaveContents(taskParameters, moduleInfo)
            )
         );
      }
   }

   if (tasks.length === 0) {
      return skipBuildFonts;
   }

   const buildFonts = taskParameters.metrics.createTimer('build icons font');
   return gulp.series(
      buildFonts.start(),
      gulp.parallel(tasks),
      buildFonts.finish()
   );
}

module.exports = generateTaskForBuildFonts;
