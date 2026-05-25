use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Site {
    pub id:              i64,
    pub project_id:      i64,
    pub project_name:    String,  // join
    pub name:            String,
    pub domain:          String,
    pub url:             String,
    pub gsc_property:    Option<String>,
    pub ga4_property:    Option<String>,
    pub bwt_property:    Option<String>,
    pub clarity_project: Option<String>,
    pub notes:           Option<String>,
    pub is_active:       bool,
    pub last_audit_score: Option<i64>,  // from dom_audits
    pub last_audit_at:   Option<String>,
    pub created_at:      String,
    pub updated_at:      String,
}

#[derive(Debug, Deserialize)]
pub struct CreateSite {
    pub project_id:      i64,
    pub name:            String,
    pub domain:          String,
    pub url:             String,
    pub gsc_property:    Option<String>,
    pub ga4_property:    Option<String>,
    pub bwt_property:    Option<String>,
    pub clarity_project: Option<String>,
    pub notes:           Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateSite {
    pub name:            Option<String>,
    pub domain:          Option<String>,
    pub url:             Option<String>,
    pub gsc_property:    Option<String>,
    pub ga4_property:    Option<String>,
    pub bwt_property:    Option<String>,
    pub clarity_project: Option<String>,
    pub notes:           Option<String>,
    pub is_active:       Option<bool>,
}
