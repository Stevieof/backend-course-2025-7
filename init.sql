CREATE TABLE IF NOT EXISTS items (
                                     id SERIAL PRIMARY KEY,
                                     name TEXT NOT NULL,
                                     description TEXT,
                                     photo_file_name TEXT
);