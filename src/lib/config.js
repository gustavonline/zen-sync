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
        default: 0 // 0 = Disabled, otherwise minutes
    }
};

const config = new Conf({ projectName: 'zensync', schema });

export default config;
