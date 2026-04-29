import Conf from 'conf';

const schema = {
	repoPath: {
		type: 'string',
		default: process.cwd()
	},
	zenPath: {
		type: 'string'
	},
    autoSyncInterval: {
        type: 'number',
        default: 1 // live checkpoint interval in minutes; 0 = disabled
    }
};

const config = new Conf({ projectName: 'zensync', schema });

export default config;
