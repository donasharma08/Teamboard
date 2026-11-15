// `npm start` entry: production mode on every OS (no NODE_ENV=... prefix, which Windows does not understand).
process.env.NODE_ENV = 'production';
await import('./index.js');

export {};
