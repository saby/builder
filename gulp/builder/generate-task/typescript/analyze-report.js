/**
 * Задача анализации логов компиляции Typescript.
 *
 * Здесь происходит разбор диагностических сообщений и их обработка в зависимости от категории кода ошибки
 * (диагностические сообщения категоризированы автоматически в файле resources/typescript-diagnostic-messages.js).
 *
 * Критические ошибки вне зависимости от того, включен ли в модуле typeCheck или нет, всегда роняют сборку.
 * Все остальные ошибки и предупреждения выводятся в зависимости от флага typeCheck, заданного в s3mod файле модуля.
 *
 * @author Krylov M.A.
 */
/* eslint-disable prefer-destructuring */
'use strict';

const fs = require('fs-extra');
const logger = require('../../../../lib/logger').logger();
const { path } = require('../../../../lib/platform/path');
const { formatEntry } = require('../../../../lib/logger');
const { unlockBuildInfo } = require('../../../common/classes/build-info');
const getMetricsReporter = require('../../../common/classes/metrics-reporter');

const typescriptDiagnosticMessages = require('../../../../resources/typescript-diagnostic-messages');

/**
 * Сборка Typescript произошла без ошибок.
 * @type {number}
 */
const SUCCESS_CODE = 0;

/**
 * Сборка Typescript произошла с предупреждениями.
 * @type {number}
 */
const WARNING_CODE = 1;

/**
 * Сборка Typescript произошла с ошибками. Сборку предпочтительно завершить.
 * @type {number}
 */
const ERROR_CODE = 2;

/**
 * Сборка Typescript произошла с критическими ошибками. Сборка должна быть завершена немедленно.
 * @type {number}
 */
const CRITICAL_ERROR_CODE = 3;

/**
 * Установить новый общий результирующий код typescript копиляции.
 * @param {number} currentCode Текущий код.
 * @param {number} newCode Новый код.
 * @returns {*}
 */
function getUpdatedCode(currentCode, newCode) {
   return currentCode < newCode ? newCode : currentCode;
}

/**
 * Разобрать многострочное диагностическое сообщение.
 * @param {string} message Сообщение, выводимое tsc компилятором.
 * @returns {object} Возвращает object represented диагностическое сообщение.
 */
function parseMessage(message) {
   const info = {
      raw: message
   };

   let error = message;
   let hasData = false;

   try {
      // Разбор модифицированного сообщения, в котором добавлена информация о модуле и ответственном.
      const locationRe = /^location:\s*\[module:\s*([^\s\]]+)(\s+[^\]]+)?\]\s*(.*)$/gs.exec(error);
      if (locationRe) {
         info.location = {
            module: locationRe[1]
         };

         error = locationRe[3];
      }

      // Разбор начала оригинального сообщения, которое начинается с пути до файла и локализации места ошибки в файле.
      const fileRe = /^([^(]+)(\(\d+,\d+\)):\s*(.*)$/gs.exec(error);
      if (fileRe) {
         info.file = {
            path: fileRe[1],
            loc: fileRe[2]
         };

         error = fileRe[3];

         if (!info.location && !info.file.path.startsWith('..')) {
            info.location = {
               module: info.file.path.split('/').shift()
            };
         }
      }

      // Выделение кода и текста ошибки.
      const errorRe = /^error\s*TS(\d+):\s*(.*)$/gs.exec(error);
      if (errorRe) {
         info.code = Number.parseInt(errorRe[1], 10);
         info.message = errorRe[2];
         hasData = true;
      }

      if (!hasData) {
         logger.debug(`Typescript report analyzer: could not parse line:\n${message}`);
      }
   } catch (e) {
      logger.debug(`Typescript report analyzer error: ${e.message}`);
   }

   return hasData ? info : { raw: message };
}

/**
 * Последовательно обработать многострочные диагностические сообщения.
 * @param {string} contents Содержимое файла с сообщениями от tsc.
 * @param {Function} callback Обработчик диагностического сообщения.
 */
function forEachMessage(contents, callback) {
   const lines = contents
      .replace(/\r/g, '')
      .split('\n');

   let lastMessage = '';
   for (const line of lines) {
      if (!line) {
         // Пропустить пустую строку
         continue;
      }

      if (line.startsWith(' ')) {
         // Продолжение предыдущего сообщения
         lastMessage += `\n${line}`;
         continue;
      }

      // Получено новое сообщение
      if (lastMessage) {
         // Сброс прошлого сообщения, если оно есть
         callback(parseMessage(lastMessage));
      }

      lastMessage = line;
   }

   if (lastMessage) {
      // Сброс прошлого сообщения, если оно есть
      callback(parseMessage(lastMessage));
   }
}

/**
 * Проверить, относится ли диагностическое сообщение к файлам из директории node_modules.
 * Примечание: используемые нами пакеты могут содержать некорректное описание типов, на которое мы повлиять не можем.
 * Такие ошибки необходимо игнорировать, и ни в коем случае не ронять сборку.
 * @param {object} info Распарсенное диагностическое сообщение Typescript.
 * @returns {boolean}
 */
function isMessageFromNodeModules(info) {
   return (
      typeof info.code === 'number' &&
      typeof info.file !== 'undefined' &&
      info.file.path.includes('/node_modules/')
   );
}

/**
 * Проверить, нужно ли игнорировать диагностическое сообщение TS2307: Cannot find module.
 * Данные сообщения необходимо игнорировать только для внешних модулей проекта.
 * @param {Set<string>} externalModules Множество внешних модулей проекта.
 * @param {object} info Распарсенное диагностическое сообщение Typescript.
 * @returns {boolean} Вовзращает true, если диагностическое сообщение нужно игнорировать.
 */
function shouldIgnoreCannotFindModule(externalModules, info) {
   if (typeof info.message !== 'string') {
      return false;
   }

   const moduleSpecifier = info.message
      .replace(/^Cannot find module '/gi, '')
      .replace(/' or its corresponding type declarations.$/gi, '');

   if (moduleSpecifier.startsWith('/cdn/')) {
      // Если зависимость ведет на cdn-ресурс, то такое диагностическое сообщение необходимо пропустить,
      // потому что на этапе сборки нет доступа к cdn-ресурсам.
      return true;
   }

   if (moduleSpecifier.startsWith('.')) {
      // Если зависимость задана относительным путем, то такое диагностическое сообщение необходимо обработать.
      return false;
   }

   const uiModule = moduleSpecifier.split('/').shift();

   if (uiModule.endsWith('-meta')) {
      // Если зависимость ведет на модуль с метатипами, то такое диагностическое сообщение необходимо пропустить.
      // Файлы метатипов имеют расширение *.meta.ts, но компилируются в *.js.
      // TODO: https://online.sbis.ru/opendoc.html?guid=23baa6c3-ff05-4774-9d58-85cd40e71dbb&client=3
      return true;
   }

   // В остальных случаях выводим все диагностические сообщения за исключением тех,
   // которые ссылаются на external интерфейсные модули.
   return externalModules.has(uiModule);
}

/**
 * Создать задачу анализа диагностических сообщений после работы tsc.
 * @param {TaskParameters} taskParameters Параметры сборки.
 * @param {string} logFile Путь до файла с диагностическими сообщениями.
 * @param {object[]} allMessages Коллекция всех обработанных соощений от tsc.
 * @returns {function} Возвращает асинхронную функцию-задачу.
 */
function analyzeReport(taskParameters, logFile, allMessages) {
   return async function analyzeReportTask() {
      if (!taskParameters.config.typescriptChanged) {
         return;
      }

      if (process.env['builder-tests-skip-tsc-messages']) {
         return;
      }

      const modules = new Map(
         taskParameters.config.modules
            .map(moduleInfo => [moduleInfo.name, moduleInfo])
      );

      const externalModules = new Set(taskParameters.config.externalModules);

      const totalContents = [];
      const contents = await fs.readFile(logFile, 'utf8');

      // TODO: для нужд анализа на время раскатки typecheck по модулям сохраняем оригинальный отчет в логах.
      await fs.copy(logFile, path.join(path.dirname(logFile), 'builder_compilation_errors_full_original.log'));

      let overallCode = SUCCESS_CODE;
      forEachMessage(contents, (info) => {
         // TODO: Не самое удачное место для кода, который относится только к unit тестам.
         //    Необходимо в целом избавиться от этого флага.
         if (process.env['builder-tests']) {
            logger.info({
               message: info.raw
            });

            return;
         }

         if (isMessageFromNodeModules(info)) {
            return;
         }

         allMessages.push(info);

         if (!info.location || !info.file) {
            // Сообщение об ошибке в файле вне проекта или об ошибке в конфигурации, либо текст ошибки плохо разобрали.
            // Такое сообщение пропускать нельзя.
            overallCode = getUpdatedCode(overallCode, ERROR_CODE);
            logger.error({
               message: info.raw
            });

            return;
         }

         const moduleInfo = modules.get(info.location.module);
         const formattedMessage = formatEntry({ message: info.raw, moduleInfo }).message;

         if (typescriptDiagnosticMessages.critical.has(info.code)) {
            // Критическая ошибка. Скопилированный код неработоспособен.
            overallCode = getUpdatedCode(overallCode, CRITICAL_ERROR_CODE);

            taskParameters.cache.markFileAsFailed(info.file.path);
            if (moduleInfo) {
               getMetricsReporter().markFailedModule(moduleInfo);
            }
            totalContents.push(formattedMessage);
            logger.error({
               message: info.raw,
               moduleInfo
            });

            return;
         }

         if (!moduleInfo) {
            logger.debug(`При обработке следующего сообщения не был найден соответствующий moduleInfo: ${JSON.stringify(info, null, 3)}`);

            return;
         }

         if (moduleInfo.typescript.typecheck || typescriptDiagnosticMessages.alwaysError.has(info.code)) {
            if (info.code === 2307) {
               // Игнорируем сообщения Cannot find module для external модулей, cdn зависимостей и *.meta.ts файлов.
               if (shouldIgnoreCannotFindModule(externalModules, info)) {
                  return;
               }

               if (!moduleInfo.typescript.typecheck) {
                  // TODO: Пока что выводим как предупреждение, чтобы не ломать сборки.
                  //    Как только все проблемы будут вычищены, переключаем на уровень ошибки.
                  totalContents.push(formattedMessage);
                  logger.warning({
                     message: info.raw,
                     moduleInfo
                  });

                  return;
               }
            }

            if (typescriptDiagnosticMessages.error.has(info.code)) {
               // Ошибка. Скопилированный код потенциально неработоспособен.
               overallCode = getUpdatedCode(overallCode, ERROR_CODE);

               taskParameters.cache.markFileAsFailed(info.file.path);
               getMetricsReporter().markFailedModule(moduleInfo);
               totalContents.push(formattedMessage);
               logger.error({
                  message: info.raw,
                  moduleInfo
               });

               return;
            }

            if (typescriptDiagnosticMessages.warning.has(info.code)) {
               overallCode = getUpdatedCode(overallCode, WARNING_CODE);

               totalContents.push(formattedMessage);
               logger.warning({
                  message: info.raw,
                  moduleInfo
               });
            }
         }
      });

      let errorMessage;
      const tail = `More details in file: "${logFile}"`;
      if (overallCode === CRITICAL_ERROR_CODE) {
         errorMessage = `TypeScript compilation was completed with critical errors. ${tail}`;
         logger.error(errorMessage);
      } else if (overallCode === ERROR_CODE) {
         errorMessage = `TypeScript compilation was completed with errors. ${tail}`;
         logger.error(errorMessage);
      } else if (overallCode === WARNING_CODE) {
         logger.error(`TypeScript compilation was completed with warnings. ${tail}`);
      } else if (overallCode === SUCCESS_CODE) {
         logger.info('TypeScript compilation was completed successfully!');
      }

      await fs.outputFile(logFile, totalContents.join('\n'));

      if (overallCode === CRITICAL_ERROR_CODE) {
         // Очищаем кеш в случае критической ошибки
         // (сюда также входят и ошибки конфигурации tsc, и ошибки с файловой системой).
         logger.debug(`Removing tsc cache and output directories due to critical error (code ${CRITICAL_ERROR_CODE})`);

         await fs.promises.rm(taskParameters.config.tscCachePath, { force: true, recursive: true });
         await fs.promises.rm(taskParameters.config.typescriptOutputDir, { force: true, recursive: true });
      }

      if (errorMessage) {
         await fs.remove(taskParameters.config.tscCacheLockFile);

         // Перед аварийным завершением задачи сборки TypeScript выполняем обновление builder.lockfile,
         // который выставит корректное состояние для кеша, чтобы при следующем запуске кеш полностью не сбрасывался.
         // При ошибках tsc нет необходимости в полном сбросе кеша.
         try {
            unlockBuildInfo(taskParameters.config.cachePath);
         } catch (error) {
            // Игнорируем ошибки. Их поймает следующий обработчик в buildInfoExitHandler.
         }

         await saveAllChangedFilesAsFailed(taskParameters);

         throw new Error(errorMessage);
      }
   };
}

// функция, которая сохраняет в кеше билдера информацию обо всех изменённых и удалённых файлах в случае
// если tsc завершился с ошибкой. Это нужно для того, чтобы в следующей сборке данные файлы были собраны
// принудительно даже если wasaby-cli не передал никаких изменений.
async function saveAllChangedFilesAsFailed(taskParameters) {
   const result = {
      tscFilesWithErrors: {}
   };

   taskParameters.config.modules.forEach((moduleInfo) => {
      if (moduleInfo.changedFiles && moduleInfo.changedFiles.length > 0) {
         result.tscFilesWithErrors[moduleInfo.name] = [...moduleInfo.changedFiles];
      }

      if (moduleInfo.deletedFiles.length > 0) {
         result.tscFilesWithErrors[moduleInfo.name] = [
            ...result.tscFilesWithErrors[moduleInfo.name],
            ...moduleInfo.deletedFiles
         ];
      }
   });

   await fs.outputJson(path.join(taskParameters.config.cachePath, 'builder-extra-config.json'), result);
}

module.exports = analyzeReport;
module.exports.parseMessage = parseMessage;
module.exports.forEachMessage = forEachMessage;
