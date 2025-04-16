'use strict';

// список модулей, которые на текущий момент могут спокойно собираться через project references
// Остальные нуждаются в исправлении ошибок и переводе на строгий тайпчек, либо зависят от модулей
// в которых есть ошибки и перед переводом на project references и внесением в данный список в них
// сперва нужно исправить все ошибки
module.exports = [
   'Application',
   'RequireJsLoader',
   'WasabyLoader',
   'Types',
   'I18n',
   'Typescript',
   'Env',
   'WS.Core',
   'SbisEnv',
   'EnvTouch',
   'UI',
   'UICommon',
   'UICore',
   'Meta',
   'Browser',
   'BrowserAPI',
   'EnvConfig',
   'ParametersWebAPI',
   'TransportCore',
   'SAP',
   'SAPLocal',
   'SAPService',
   'Router'
];
