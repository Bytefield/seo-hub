use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct User {
    pub id:         i64,
    pub name:       String,
    pub has_pin:    bool,   // never expose pin_hash to frontend
    pub created_at: String,
    pub updated_at: String,
}
