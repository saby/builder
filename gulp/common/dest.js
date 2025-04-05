/**
 * Модель предоставляет расширение над встроенной функцией gulp.dest,
 * позволяющая записывать Vinyl файлы в директории региональных сборок.
 *
 * Чтобы файл попал в директорию региональной сборки необходимо,
 * чтобы на файле было установлено свойство region, принимающее значение кода целевой страны.
 *
 * @author Krylov M.A.
 */
'use strict';

const gulp = require('gulp');
const gulpIf = require('gulp-if');

const { needSymlink } = require('./helpers');

function destOrSymlink(taskParameters, moduleInfo, outputPath) {
   return gulpIf(
      needSymlink(taskParameters, taskParameters.config, moduleInfo, taskParameters.cache.isFirstBuild()),
      gulp.symlink(outputPath),
      gulp.dest(outputPath)
   );
}

function dest(taskParameters, moduleInfo) {
   let stream = destOrSymlink(taskParameters, moduleInfo, moduleInfo.output);

   if (moduleInfo.regionOutput) {
      for (const region in moduleInfo.regionOutput) {
         if (moduleInfo.regionOutput.hasOwnProperty(region)) {
            stream = gulpIf(
               vinyl => vinyl.region === region,
               destOrSymlink(taskParameters, moduleInfo, moduleInfo.regionOutput[region]),
               stream
            );
         }
      }
   }

   return stream;
}

module.exports = dest;
