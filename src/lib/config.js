import Conf from 'conf';

const schema = {
	repoPath: {
		type: 'string',
		default: process.cwd()
	},
	zenPath: {
		type: 'string'
	},
    lastSync: {
        type: 'string'
    }
};

const config = new Conf({ projectName: 'zensync', schema });

export default config;
