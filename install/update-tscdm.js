/**
 * Скрипт генерации категоризированной коллекции кодов ошибок Typescript:
 * 1) critical - критические ошибки компиляции (ошибки токенизацтора и парсера, конфигурации tsc или работы с fs).
 *    При таких ошибках сборка должна завершаться немедленно, т.к. выполнение последующих задач сборки невозможно.
 * 2) error - некритические ошибки компиляции. Сюда попадают коды всех ошибок, category которых есть 'Error'.
 *    В случае возникновения таких ошибок сборку желательно завершать.
 * 3) message - информационные сообщения компилятора Typescript, которые должны выводиться как warning или info.
 *
 * Данные о всех диагностических сообщениях берутся из официального репозитория Typescript на github.
 *
 * Коллекцию необходимо поддерживать в актуальном состоянии!
 *
 * В константе ciReportUrls можно задать список url на полные отчеты tsc,
 * чтобы выяснить наличие критических ошибок в критичных сборках.
 *
 * @author Krylov M.A.
 */

/* eslint-disable no-console, global-require */
'use strict';

const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs-extra');

/**
 * TODO: Пока typecheck не будет включен во всех модулях, по умолчанию оставляем набор кодов ошибок и предупреждений,
 *    которые ни в коем случае нельзя пропускать, вне зависимости от того, включен typecheck или нет.
 *    Здесь размещаются все коды, которые приводят к последующим ошибкам парсинга файлов в задачах сборки,
 *    либо делают js файлы нерабочими, например, в IE.
 *    В конечном счете список исключений необходимо удалить!
 * @type {Set<number>}
 */
const exceptionalCodes = new Set([
   1002,
   1003,
   1005,
   1006,
   1007,
   1068,
   1069,
   1108,
   1109,
   1110,
   1012,
   1117,
   1124,
   1127,
   1128,
   1129,
   1130,
   1131,
   1132,
   1133,
   1134,
   1135,
   1136,
   1137,
   1138,
   1139,
   1140,
   1141,
   1144,
   1145,
   1146,
   1160,
   1161,
   1163,
   1177,
   1178,
   1179,
   2393,
   17001,
   17009
]);

const sourceCommit = 'fcaa900012252bf2ed90ab31e1a7e4660c88bf28';
const sourceUrl = `https://raw.githubusercontent.com/microsoft/TypeScript/${sourceCommit}/src/compiler/diagnosticMessages.json`;

const outputFile = 'resources/typescript-diagnostic-messages.js';

const ciReportUrls = [];

const toSource = codes => (`\
/*
 * AUTOGENERATED FILE.
 */
/* eslint-disable quotes, max-len */
'use strict';

const exceptional = ${JSON.stringify(codes.exceptional, null, 3)};
const critical = ${JSON.stringify(codes.critical, null, 3)};

module.exports = {
   exceptional: new Set(Array.from(Object.values(exceptional))),
   critical: new Set(Array.from(Object.values(critical))),
   error: new Set([${Array.from(Object.values(codes.error)).join(', ')}]),
   message: new Set([${Array.from(Object.values(codes.message)).join(', ')}])
};
`);

function load(url, callback) {
   console.log(`Loading file from "${url}"...`);

   (url.startsWith('https:') ? https : http)
      .get(url, (res) => {
         const { statusCode } = res;

         if (statusCode !== 200) {
            console.error(`Request failed. Status Code: ${statusCode}`);

            return;
         }

         let data = '';
         res.setEncoding('utf8');
         res.on('data', (chunk) => {
            data += chunk;
         });
         res.on('end', () => callback(data));
      })
      .on('error', (e) => {
         console.error(`Got error: ${e.message}`);
      });
}

// Если необходимо проверить, положит ли текущую сборку список сформированных критических кодов.
function testCiReport(ciReportUrl) {
   console.log();
   load(ciReportUrl, (data) => {
      try {
         console.log('Critical typescript errors:');

         require('../lib/logger').setGulpLogger();
         const { forEachMessage } = require('../gulp/builder/generate-task/typescript/analyze-report');
         const typescriptDiagnosticMessages = require('../resources/typescript-diagnostic-messages');

         let hasError = false;
         forEachMessage(data, (info) => {
            if (!info.location || !info.file) {
               console.error(info.raw);
               hasError = true;
               return;
            }

            if (typescriptDiagnosticMessages.critical.has(info.code)) {
               console.error(info.raw);
               hasError = true;
            }
         });

         if (!hasError) {
            console.log('No error was found.');
         }

         console.log('Done.');
      } catch (e) {
         console.error(e.message);
      }
   });
}

load(sourceUrl, (data) => {
   try {
      const diagnosticMessages = JSON.parse(data);
      const codes = {
         critical: { },
         error: { },
         message: { },
         exceptional: { }
      };

      Object.keys(diagnosticMessages).forEach((message) => {
         const { code, category } = diagnosticMessages[message];

         if (exceptionalCodes.has(code)) {
            codes.exceptional[message] = code;
         }

         if ((code >= 5000 && code < 6000)) {
            // Критические ошибки конфигурации tsc и работы с fs. После typescript задачи ничего не должно запускаться.
            codes.critical[message] = code;
         } else if (category === 'Error') {
            // Скомпилированные файлы могут быть невалидными. Лучше после typescript сборку прекращать.
            codes.error[message] = code;
         } else if (category === 'Message') {
            // Прочие диагностические сообщения. С такими сообщениями сборка может быть зеленой.
            codes.message[message] = code;
         } else if (category === 'Suggestion') {
            // Самый низкий приоритет сообщений. Включить при необходимости.
         } else {
            console.warn(`Unknown category ${category} for message code ${code}`);
         }
      });

      const outputFilePath = path.join(__dirname, `../${outputFile}`);

      fs.outputFileSync(outputFilePath, toSource(codes), 'utf-8');

      console.log(`File "${outputFile}" successfully updated.`);

      ciReportUrls.forEach(url => testCiReport(url));
   } catch (e) {
      console.error(e.message);
   }
});
