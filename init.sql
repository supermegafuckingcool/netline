-- Grant the netline user permission to create databases
-- (needed by Prisma's shadow database during migrations)
GRANT ALL PRIVILEGES ON *.* TO 'netline'@'%';
FLUSH PRIVILEGES;
