/**
 * @author Kolbeshin F.A.
 */
'use strict';

const logger = require('../logger').logger();

function getError(...args) {
   for (let i = 0; i < args.length; ++i) {
      if (args[i] instanceof Error) {
         return args[i];
      }
   }

   return undefined;
}

function formatMessage(message) {
   if (typeof message === 'string') {
      return message;
   }

   return JSON.stringify(message);
}

function createMessage(label, tag, msg) {
   const parts = [label];

   if (tag) {
      parts.push(formatMessage(tag));
   }

   if (msg) {
      parts.push(formatMessage(msg));
   }

   return parts.join('::');
}

module.exports = {
   error(tag, msg, err) {
      // В 21.5100 продолжим выводить как предупреждение, потому что есть проблемы с шаблонами.
      logger.warning({
         error: getError(tag, msg, err),
         message: createMessage('WS error', tag, msg)
      });
   },
   warn(tag, msg, err) {
      logger.warning({
         error: getError(tag, msg, err),
         message: createMessage('WS warning', tag, msg)
      });
   },
   info(tag, msg) {
      logger.info(createMessage('WS', tag, msg));
   },
   log(tag, msg) {
      logger.debug(createMessage('WS', tag, msg));
   }
};
