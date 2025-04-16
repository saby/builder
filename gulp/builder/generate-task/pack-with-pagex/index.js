/**
 * Модуль реализует задачу паковки JS, CSS, lang ресурсов по PageX.
 *
 * @author Krylov M.A.
 */
'use strict';

const gulp = require('gulp');

const logger = require('../../../../lib/logger').logger();
const generatePrepareWorkspace = require('./prepare-workspace');
const generateReadPageX = require('./read-pagex');
const generateReadRoutes = require('./read-routes');
const generateLoadDependencies = require('./load-dependencies');
const generateBuildPackages = require('./build-packages');
const generateWritePackages = require('./write-packages');
const readConfiguration = require('./config');

const FEATURE_ENABLED = false;

/**
 * Задача требует наличия в проекте определенных модулей.
 * Без них выполнение задачи невозможно.
 * @type {string[]}
 */
const REQUIRED_MODULES = [
   'SabyPage',
   'SabyPageLayoutPackages',
   'SabyPageContentPackages'
];

function skipPackWithPageX(done) {
   return done();
}

function isFeatureEnabled(modules) {
   if (!FEATURE_ENABLED) {
      return false;
   }

   const projectModules = new Set(modules.map(moduleInfo => moduleInfo.name));

   return REQUIRED_MODULES.every(requiredModule => projectModules.has(requiredModule));
}

function generatePackWithPageX(taskParameters) {
   if (!isFeatureEnabled(taskParameters.config.modules)) {
      logger.debug('Resource packing with PageX is disabled');

      return skipPackWithPageX;
   }

   const workspace = {
      config: readConfiguration(taskParameters.config.modules),
      resourcesUrl: taskParameters.config.resourcesUrl ? 'resources/' : ''
   };

   if (!workspace.config.enabled) {
      logger.debug('Resource packing with PageX is disabled with config file');

      return skipPackWithPageX;
   }

   const timer = taskParameters.metrics.createTimer('pack resources with pagex');

   return gulp.series(
      timer.start(),
      generatePrepareWorkspace(taskParameters, workspace),
      timer.lap('prepare workspace'),
      gulp.parallel(
         generateReadPageX(taskParameters, workspace),
         generateReadRoutes(taskParameters, workspace),
         generateLoadDependencies(taskParameters, workspace),
      ),
      timer.lap('collect dependencies'),
      generateBuildPackages(taskParameters, workspace),
      timer.lap('build packages'),
      generateWritePackages(taskParameters, workspace),
      timer.lap('write packages'),
      timer.finish()
   );
}

module.exports = generatePackWithPageX;
