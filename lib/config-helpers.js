/* eslint-disable global-require */
'use strict';

const { path, cwd } = require('./platform/path');
const fs = require('fs-extra');
const logger = require('./logger').logger();
const ISO639 = {

   // Афарский
   aa: 'Afaraf',

   // Абхазский
   ab: 'аҧсшәа',

   // Авестийский
   ae: 'avesta',

   // Африкаанс
   af: 'Afrikaans',

   // Акан
   ak: 'Akan',

   // Амхарский
   am: 'አማርኛ',

   // Арагонский
   an: 'aragonés',

   // Арабский
   ar: 'ةيبرعلا',

   // Ассамский
   as: 'অসমীয়া',

   // Аварский
   av: 'авар мацӀ',

   // Аймара
   ay: 'aymar aru',

   // Азербайджанский

   az: 'azərbaycan dili',

   // Башкирский

   ba: 'башҡорт теле',

   // Белорусский

   be: 'беларуская мова',

   // Болгарский

   bg: 'български език',

   // Бихари
   bh: 'भोजपुरी',

   // Бислама
   bi: 'Bislama',

   // Бамбара
   bm: 'bamanankan',

   // Бенгальский
   bn: 'বাংলা',

   // Тибетский
   bo: 'བོད་ཡིག',

   // Breton
   br: 'brezhoneg',

   // Боснийский
   bs: 'bosanski jezik',

   // Каталанский
   ca: 'català',

   // Чеченский
   ce: 'нохчийн мотт',

   // Чаморро
   ch: 'Chamoru',

   // Корсиканский
   co: 'corsu',

   // Крик
   cr: 'ᓀᐦᐃᔭᐍᐏᐣ',

   // Чешский
   cs: 'český jazyk',

   // Чувашский
   cv: 'чӑваш чӗлхи',

   // Валлийский
   cy: 'Cymraeg',

   // Датский
   da: 'dansk',

   // Немецкий
   de: 'Deutsch',

   // Дивехи
   dv: 'ދިވެހި',

   // Дзонг-кэ
   dz: 'རྫོང་ཁ',

   // Эве
   ee: 'Eʋegbe',

   // Греческий
   el: 'ελληνικά',

   // Английский
   en: 'English',

   // Эсперанто
   eo: 'Esperanto',

   // Испанский
   es: 'español',

   // Эстонский
   et: 'eesti keel',

   // Баскский
   eu: 'euskara',

   // Персидский
   fa: 'فارسی',

   // Фулах
   ff: 'Fulfulde',

   // Финский
   fi: 'suomen kieli',

   // Фиджи
   fj: 'vosa Vakaviti',

   // Фарерский
   fo: 'føroyskt',

   // Французский
   fr: 'français',

   // Фризский
   fy: 'Frysk',

   // Ирландский
   ga: 'Gaeilge',

   // Гэльский
   gd: 'Gàidhlig',

   // Галисийский
   gl: 'galego',

   // Гуарани
   gn: "Avañe'ẽ",

   // Гуджарати
   gu: 'ગુજરાતી',

   // Мэнский
   gv: 'Gaelg',

   // Хауса
   ha: 'هَوُسَ',

   // Иврит
   he: 'עברית',

   // Хинди
   hi: 'हिन्दी',

   // Хиримоту
   ho: 'Hiri Motu',

   // Хорватский
   hr: 'hrvatski jezik',

   // Haitian
   ht: 'Kreyòl ayisyen',

   // Венгерский
   hu: 'magyar',

   // Армянский
   hy: 'Հայերեն',

   // Гереро
   hz: 'Otjiherero',

   // Интерлингва
   ia: 'Interlingua',

   // Индонезийский
   id: 'Bahasa Indonesia',

   // Интерлингве
   ie: 'Interlingue',

   // Игбо
   ig: 'Asụsụ Igbo',

   // Сычуань
   ii: 'Nuosuhxop',

   // Инупиак
   ik: 'Iñupiaq',

   // Идо
   io: 'Ido',

   // Исландский
   is: 'Íslenska',

   // Итальянский
   it: 'italiano',

   // Инуктитут
   iu: 'ᐃᓄᒃᑎᑐᑦ',

   // Японский
   ja: '日本語',

   // Яванский
   jv: 'basa Jawa',

   // Грузинский
   ka: 'ქართული',

   // Конго
   kg: 'KiKongo',

   // Кикуйю
   ki: 'Gĩkũyũ',

   // Киньяма
   kj: 'Kuanyama',

   // Казахский
   kk: 'Қазақ тілі',

   // Гренландский
   kl: 'kalaallisut',

   // Кхмерский
   km: 'ខ្មែរ',

   // Каннада
   kn: 'ಕನ್ನಡ',

   // Корейский
   ko: '한국어',

   // Канури
   kr: 'Kanuri',

   // Кашмири
   ks: 'कश्मीरी',

   // Курдский
   ku: 'Kurdî',

   // Коми
   kv: 'коми кыв',

   // Корнский
   kw: 'Kernewek',

   // Киргизский
   ky: 'Кыргыз тили',

   // Латинский
   la: 'latine',

   // Люксембургский
   lb: 'Lëtzebuergesch',

   // Ганда
   lg: 'Luganda',

   // Limburgan
   li: 'Limburgs',

   // Лингала
   ln: 'Lingála',

   // Лаосский
   lo: 'ພາສາລາວ',

   // Литовский
   lt: 'lietuvių kalba',

   // Луба-катанга
   lu: 'Tshiluba',

   // Латышский
   lv: 'latviešu valoda',

   // Малагасийский
   mg: 'fiteny malagasy',

   // Маршалльский
   mh: 'Kajin M̧ajeļ',

   // Маори
   mi: 'te reo Māori',

   // Македонский
   mk: 'македонски јазик',

   // Малаялам
   ml: 'മലയാളം',

   // Монгольский
   mn: 'монгол',

   // Маратхи
   mr: 'मराठी',

   // Малайский
   ms: 'bahasa Melayu',

   // Мальтийский
   mt: 'Malti',

   // Бирманский
   my: 'ဗမာစာ',

   // Науру
   na: 'Ekakairũ Naoero',

   // Норвежский‬ книжный
   nb: 'Norsk bokmål',

   // Ндебеле северный
   nd: 'isiNdebele',

   // Непальский
   ne: 'नेपाली',

   // Ндунга
   ng: 'Owambo',

   // Нидерландский
   nl: 'Nederlands',

   // Нюнорск (Норвежский новый)
   nn: 'Norsk nynorsk',

   // Норвежский‬
   no: 'Norsk',

   // Ндебеле южный
   nr: 'isiNdebele',

   // Навахо
   nv: 'Diné bizaad',

   // Ньянджа
   ny: 'chiCheŵa',

   // Окситанский
   oc: 'occitan',

   // Оджибве
   oj: 'ᐊᓂᔑᓈᐯᒧᐎᓐ',

   // Оромо
   om: 'Afaan Oromoo',

   // Ория
   or: 'ଓଡ଼ିଆ',

   // Осетинский
   os: 'ирон æвзаг',

   // Пенджабский
   pa: 'ਪੰਜਾਬੀ',

   // Пали
   pi: 'पाऴि',

   // Польский
   pl: 'język polski',

   // Пушту
   ps: 'پښتو',

   // Португальский
   pt: 'português',

   // Кечуа
   qu: 'Runa Simi',

   // Ретороманский
   rm: 'rumantsch grischun',

   // Рунди
   rn: 'Ikirundi',

   // Румынский
   ro: 'limba română',

   // Русский язык
   ru: 'Русский',

   // Руанда
   rw: 'Ikinyarwanda',

   // Санскрит
   sa: 'संस्कृतम्',

   // Сардинский
   sc: 'sardu',

   // Синдхи
   sd: 'सिन्धी',

   // Северносаамский язык
   se: 'Davvisámegiella',

   // Санго
   sg: 'yângâ tî sängö',

   // Сингальский
   si: 'සිංහල',

   // Словацкий
   sk: 'slovenčina',

   // Словенский
   sl: 'slovenski jezik',

   // Самоанский
   sm: "gagana fa'a Samoa",

   // Шона
   sn: 'chiShona',

   // Сомали
   so: 'Soomaaliga',

   // Албанский
   sq: 'gjuha shqipe',

   // Сербский
   sr: 'српски језик',

   // Свази
   ss: 'SiSwati',

   // Сото южный
   st: 'Sesotho',

   // Сунданский
   su: 'Basa Sunda',

   // Шведский
   sv: 'Svenska',

   // Суахили
   sw: 'Kiswahili',

   // Тамильский
   ta: 'தமிழ்',

   // Телугу
   te: 'తెలుగు',

   // Таджикский
   tg: 'тоҷикӣ',

   // Тайский
   th: 'ไทย',

   // Тигринья
   ti: 'ትግርኛ',

   // Туркменский
   tk: 'Түркмен',

   // Тагальский
   tl: 'Wikang Tagalog',

   // Тсвана
   tn: 'Setswana',

   // Тонганский
   to: 'faka Tonga',

   // Турецкий
   tr: 'Türkçe',

   // Тсонга
   ts: 'Xitsonga',

   // Татарский
   tt: 'татар теле',

   // Тви
   tw: 'Twi',

   // Таитянский
   ty: 'Reo Tahiti',

   // Уйгурский
   ug: 'Uyƣurqə',

   // Украинский Українська мова
   uk: 'Українська',

   // Урду
   ur: 'اردو',

   // Узбекский
   uz: 'Ўзбек',

   // Венда
   ve: 'Tshivenḓa',

   // Вьетнамский
   vi: 'Tiếng Việt',

   // Волапюк
   vo: 'Volapük',

   // Walloon
   wa: 'walon',

   // Волоф
   wo: 'Wollof',

   // Коса
   xh: 'isiXhosa',

   // Идиш
   yi: 'ייִדיש',

   // Йоруба
   yo: 'Yorùbá',

   // Чжуанский
   za: 'Saɯ cueŋƅ',

   // Китайский
   zh: '中文',

   // Зулу
   zu: 'isiZulu'
};

// languageCulture - идентификатор состоящий из языка и страны, разделённые дефисом
// язык должен быть указан строчными буквами
// страна - заглавными
function getLanguageByLocale(languageCulture) {
   return ISO639[languageCulture.split('-')[0]];
}

function removeLatestSlash(filePath) {
   if (filePath.endsWith('/') || filePath.endsWith('\\')) {
      return filePath.slice(0, filePath.length - 1);
   }
   return filePath;
}

/**
 * проверяем, что результаты компиляции записываются в исходную директорию.
 * Актуально для мини-задач, например одиночная компиляция typescript или less.
 */
function checkForSourcesOutput(config) {
   const outputDirectory = config.output;
   const { modules } = config;
   let result = false;
   modules.forEach((currentModule) => {
      const moduleDirectory = path.dirname(currentModule.path);
      if (removeLatestSlash(moduleDirectory) === removeLatestSlash(outputDirectory)) {
         result = true;
      }
   });
   return result;
}

/**
 * parse themes with modifiers
 * @param{Array} themes - array of themes
 * @returns {{}}
 */
function parseThemesFlag(themes) {
   const result = {};
   themes.forEach((currentTheme) => {
      const themeParts = currentTheme.split('__');
      const [themeName, modifier] = themeParts;

      // modifier can be an empty string.
      // F.e. themes: ["default"] means we should build all of
      // less files in interface modules with "default" theme
      // And in the same time themes: ["default__"] should mean it's
      // a default theme but without any modifier, hence we will
      if (themeParts.length === 2) {
         if (!result[themeName]) {
            result[themeName] = [modifier];
         } else if (result[themeName] instanceof Array) {
            result[themeName].push(modifier);
         }
      } else if (result[themeName] instanceof Array) {
         result[themeName].push('');
      } else {
         result[themeName] = true;
      }
   });
   return result;
}

function getTsConfigPath(tsconfig, configFile, branchTests) {
   if (tsconfig) {
      // set tsconfig as transmitted full physical path if exists
      if (fs.pathExistsSync(tsconfig)) {
         return tsconfig;
      }

      if (tsconfig.startsWith('./') || tsconfig.startsWith('../')) {
         const configPath = `${path.dirname(configFile)}/`;
         const result = path.resolve(configPath, tsconfig);
         if (fs.pathExistsSync(result)) {
            return result;
         }
      }
   }

   /**
    * saby-typescript could be:
    * 1)saby-typescript is npm package of builder
    * 2)saby-typescript and builder have the same directory
    * so choose path to it properly
    */
   let sabyTypescriptDirectory = '';
   let defaultTsConfig = '';

   if (fs.pathExistsSync(path.join(cwd(), '../saby-typescript'))) {
      sabyTypescriptDirectory = path.join(cwd(), '../saby-typescript');
   } else {
      sabyTypescriptDirectory = path.join(cwd(), 'node_modules/saby-typescript');
   }

   if (branchTests) {
      defaultTsConfig = path.join(sabyTypescriptDirectory, 'configs', 'es5.dev.json');
   } else {
      defaultTsConfig = path.join(sabyTypescriptDirectory, 'configs', 'es5.json');
   }

   logger.info(`tsconfig path wasn't specified or doesn't exist. Using default value: "${defaultTsConfig}"`);

   return defaultTsConfig;
}


function getCompilerOptions(tsconfigPath) {
   const currentTSConfig = require(tsconfigPath);

   // if current config is just config that extends another config
   // read it first and join them to return full set of options for
   // typescript compiler
   if (currentTSConfig.extends) {
      const extendsPath = path.resolve(path.dirname(tsconfigPath), currentTSConfig.extends);

      return { ...getCompilerOptions(extendsPath), ...currentTSConfig.compilerOptions };
   }

   return currentTSConfig.compilerOptions;
}

module.exports = {
   getLanguageByLocale,
   checkForSourcesOutput,
   parseThemesFlag,
   getTsConfigPath,
   getCompilerOptions
};
