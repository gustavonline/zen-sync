import Conf from 'conf';

// Separate store for volatile state (PIDs, logs path, etc)
// to avoid cluttering the main config
const state = new Conf({ 
    projectName: 'zensync', 
    configName: 'state',
    clearInvalidConfig: true 
});

export const setProcessState = (pid, status) => {
    state.set('pid', pid);
    state.set('status', status);
    state.set('lastHeartbeat', Date.now());
};

export const clearProcessState = () => {
    state.delete('pid');
    state.set('status', 'stopped');
};

export const getProcessState = () => {
    return {
        pid: state.get('pid'),
        status: state.get('status') || 'stopped',
        lastHeartbeat: state.get('lastHeartbeat'),
        lastSync: state.get('lastSync')
    };
};

export const updateLastSync = (time) => {
    state.set('lastSync', time);
};

export default state;
