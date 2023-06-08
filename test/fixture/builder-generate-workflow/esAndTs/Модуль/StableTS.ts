import Di from './Di';

// test cdn imports. Builder should save .js extensions for cdn links
import 'browser!/cdn/sound/id3-reader/id3-minimized.js';
import 'is!browser?/cdn/sound/id3-reader/id3-minimized.js';
import 'is!browser?cdn/sound/id3-reader/id3-minimized.js';
import '/cdn/sound/id3-reader/id3-minimized.js';
import 'cdn/sound/id3-reader/id3-minimized.js';

const Factory = {
    Di
};
export default Factory;
