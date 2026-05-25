use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Project {
    pub id:          i64,
    pub name:        String,
    pub description: Option<String>,
    pub color:       String,
    pub icon:        String,
    pub is_active:   bool,
    pub site_count:  i64,   // computed join
    pub created_at:  String,
    pub updated_at:  String,
}

#[derive(Debug, Deserialize)]
pub struct CreateProject {
    pub name:        String,
    pub description: Option<String>,
    pub color:       Option<String>,
    pub icon:        Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProject {
    pub name:        Option<String>,
    pub description: Option<String>,
    pub color:       Option<String>,
    pub icon:        Option<String>,
    pub is_active:   Option<bool>,
}
