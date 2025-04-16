/**
 * @author Krylov M.A.
 */
'use strict';

const logger = require('../../../../lib/logger').logger();
const execInPool = require('../../../common/exec-in-pool');

const EMPTY_ARRAY = Object.freeze([]);

function generateGetPageXLayouts(taskParameters, workspace) {
   return async function getPageXLayouts() {
      const [error, result] = await execInPool(
         taskParameters.pool,
         'getSabyPageLayouts',
         EMPTY_ARRAY
      );

      if (error) {
         logger.error({
            message: 'Ошибка загрузки раскладок',
            error
         });

         return;
      }

      workspace.layouts = result.layouts;
   };
}

module.exports = generateGetPageXLayouts;
