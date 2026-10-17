module.exports = {
  apps: [
    {
      name: "api",
      script: "dist/server.js",
      cwd: "apps/api",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 3000
      },
      watch: false
    },
    {
      name: "web",
      script: "node_modules/.bin/next",
      args: "start -p 4000",
      cwd: "apps/web",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 4000
      },
      watch: false
    },
    {
      name: "ai",
      script: ".venv/bin/uvicorn",
      args: "main:app --host 0.0.0.0 --port 8000",
      cwd: "apps/ai",
      instances: 1,
      exec_mode: "fork",
      env: {
        ENVIRONMENT: "production",
        PORT: 8000
      },
      watch: false
    }
  ]
};
