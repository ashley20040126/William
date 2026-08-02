module.exports = {
  apps: [{
    name: 'william-api',
    script: 'src/index.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3001,
    },
    max_memory_restart: '512M',
    error_file: '../log/william/error.log',
    out_file: '../log/william/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    watch: false,
  }],
};
