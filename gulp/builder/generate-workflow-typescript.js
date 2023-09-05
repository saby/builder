/**
 * Generates a workflow to run typescript compiler for current project
 * @author Kolbeshin F.A.
 */

'use strict';

const Cache = require('./classes/cache');
const Configuration = require('./classes/configuration.js');
const TaskParameters = require('../common/classes/task-parameters');
const generateTaskForTypescript = require('./generate-task/typescript');
const ConfigurationReader = require('../common/configuration-reader');

/**
 *
 * Generates a workflow to run typescript compiler for current project
 * @param processArgv - arguments of current running utility
 * @returns {function(): (Promise<void>|*)}
 */
function generateBuildWorkflowTypescript(processArgv) {
   // загрузка конфигурации должна быть синхронной, иначе не построятся задачи для сборки модулей
   const config = new Configuration();
   config.loadSync(processArgv);

   const taskParameters = new TaskParameters(config, new Cache(config));

   const { output } = ConfigurationReader.getProcessParameters(processArgv);
   if (!output) {
      // eslint-disable-next-line no-console
      console.log('output directory wasn\'t added. Using default directory instead');
   }

   return generateTaskForTypescript(taskParameters, output);
}

module.exports = generateBuildWorkflowTypescript;
