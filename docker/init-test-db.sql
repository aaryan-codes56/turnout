-- Runs once, when the Docker volume is first created.
-- Integration tests use this database so they never touch dev data.
CREATE DATABASE turnout_test;
