FROM oven/bun:1.2.22-alpine

WORKDIR /app

COPY package.json .
RUN bun install --frozen-lockfile

COPY . .

EXPOSE 8787

CMD ["bun", "run", "start"]
