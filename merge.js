const fs = require("fs");
if (!fs.existsSync("wordlist.txt")) {
  console.error("wordlist.txt missing");
  process.exit(1);
}
const lines = [];
const seen = new Set();

for (const f of ["wordlist.txt", "extra.txt"]) {
  if (!fs.existsSync(f)) continue;
  for (let line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
}

fs.writeFileSync("wordlist.txt", lines.join("\n") + "\n");
if (fs.existsSync("extra.txt")) fs.writeFileSync("extra.txt", "");
console.log(lines.length + " unique candidates");
