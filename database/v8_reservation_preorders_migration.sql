-- Run once on an existing database to add reservation preorders.

CREATE TABLE IF NOT EXISTS reservation_preorders (
  reservation_id INT PRIMARY KEY,
  contact_status ENUM('cho_lien_he','da_xac_nhan','khong_nghe_may','tu_choi')
    NOT NULL DEFAULT 'cho_lien_he',
  contacted_at DATETIME NULL,
  contacted_by INT NULL,
  preparation_status ENUM('cho_xac_nhan','da_dua_vao_bill')
    NOT NULL DEFAULT 'cho_xac_nhan',
  prepared_at DATETIME NULL,
  prepared_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE,
  FOREIGN KEY (contacted_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (prepared_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS reservation_preorder_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reservation_id INT NOT NULL,
  dish_id INT NOT NULL,
  quantity INT NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  note VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_reservation_preorder_items_reservation (reservation_id),
  FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE,
  FOREIGN KEY (dish_id) REFERENCES dishes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
